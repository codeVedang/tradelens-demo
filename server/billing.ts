import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import { fail } from "./sessions.js";

const states = [
  "FREE",
  "PAYMENT_PENDING",
  "ACTIVE",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;
type Status = (typeof states)[number];
type Subscription = {
  id: "premium";
  status: Status;
  paidThrough?: string;
  demo?: boolean;
  eventAt?: string;
};
type Checkout = { id: string; owner: string };
const verifiedEvent = z.object({
  id: z.string().min(1).max(200),
  checkoutId: z.uuid(),
  status: z.enum(states),
  eventAt: z.iso.datetime(),
  paidThrough: z.iso.datetime().optional(),
  paymentReference: z.string().min(1).max(200).optional(),
});
export type BillingEvent = z.infer<typeof verifiedEvent>;
export interface PaymentProvider {
  createCheckout(input: {
    checkoutId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  // Verify the raw signature and retrieve authoritative payment/subscription status from the gateway.
  verifyEvent(
    rawBody: Buffer,
    headers: Request["headers"],
  ): Promise<BillingEvent>;
  manageUrl?(owner: string, returnUrl: string): Promise<string>;
}
const billingOwner = "tradzyn-billing";
export function billing(
  store: Store,
  env: NodeJS.ProcessEnv,
  origin: string,
  gateway?: PaymentProvider,
) {
  const router = Router();
  const plan = {
    name: "Premium",
    price: env.PREMIUM_PRICE_LABEL?.trim() || null,
    period: env.PREMIUM_BILLING_PERIOD?.trim() || null,
  };
  const checkoutEnabled = Boolean(gateway && plan.price && plan.period);
  const get = (owner: string) =>
    store.get<Subscription>("subscription", "premium", owner);
  const active = (owner: string) => {
    const subscription = get(owner);
    return (
      subscription?.status === "ACTIVE" &&
      Date.parse(subscription.paidThrough ?? "") > Date.now()
    );
  };
  const url = (value: string) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw fail(502, "Invalid billing redirect");
    return parsed.href;
  };
  router.get("/", (req, res) => {
    const owner = res.locals.accountId as string;
    const subscription = get(owner);
    res.json({
      plan,
      checkoutEnabled: checkoutEnabled && !subscription?.demo,
      manageEnabled: Boolean(
        gateway?.manageUrl && subscription && !subscription.demo,
      ),
      active: active(owner),
      status:
        subscription?.status === "ACTIVE" && !active(owner)
          ? "EXPIRED"
          : (subscription?.status ?? "FREE"),
      paidThrough: subscription?.paidThrough ?? null,
      demo: subscription?.demo ?? false,
      payments: store.all("payment", owner),
    });
  });
  router.post("/checkout", async (_req, res) => {
    const owner = res.locals.accountId as string;
    if (!checkoutEnabled || !gateway)
      throw fail(503, "Premium checkout is awaiting owner configuration");
    if (get(owner)?.demo || active(owner))
      throw fail(409, "This account already has Premium access");
    const checkout = store.put<Checkout>(
      "checkout",
      { id: randomUUID(), owner },
      billingOwner,
    );
    const destination = await gateway.createCheckout({
      checkoutId: checkout.id,
      returnUrl: origin + "/app/settings",
    });
    res.json({ url: url(destination.url) });
  });
  router.post("/manage", async (_req, res) => {
    const owner = res.locals.accountId as string;
    if (!gateway?.manageUrl || !get(owner) || get(owner)?.demo)
      throw fail(503, "Billing management is unavailable");
    res.json({
      url: url(await gateway.manageUrl(owner, origin + "/app/settings")),
    });
  });
  const webhook = async (req: Request, res: import("express").Response) => {
    if (!gateway) throw fail(404, "Billing webhook is unavailable");
    if (!Buffer.isBuffer(req.body))
      throw fail(400, "Expected raw webhook body");
    let event: BillingEvent;
    try {
      event = verifiedEvent.parse(
        await gateway.verifyEvent(req.body, req.headers),
      );
    } catch {
      throw fail(400, "Billing event could not be verified");
    }
    const checkout = store.get<Checkout>(
      "checkout",
      event.checkoutId,
      billingOwner,
    );
    if (!checkout || get(checkout.owner)?.demo)
      throw fail(404, "Checkout not found");
    if (
      event.status === "ACTIVE" &&
      (!event.paidThrough || !event.paymentReference)
    )
      throw fail(400, "Missing verified payment or paid-through date");
    store.transaction(() => {
      if (store.get("billing_event", event.id, billingOwner)) return;
      store.put(
        "billing_event",
        { id: event.id, checkoutId: checkout.id },
        billingOwner,
      );
      if (event.paymentReference && event.status === "ACTIVE") {
        store.put(
          "payment",
          {
            id: event.paymentReference,
            date: event.eventAt,
            paidThrough: event.paidThrough,
            status: "VERIFIED",
          },
          checkout.owner,
        );
      }
      const previous = get(checkout.owner);
      if (previous?.eventAt && previous.eventAt >= event.eventAt) return;
      store.put<Subscription>(
        "subscription",
        {
          id: "premium",
          status: event.status,
          paidThrough: event.paidThrough,
          eventAt: event.eventAt,
        },
        checkout.owner,
      );
      store.put(
        "audit",
        {
          id: randomUUID(),
          action: "subscription.verified",
          at: new Date().toISOString(),
        },
        checkout.owner,
      );
    });
    res.status(204).end();
  };
  return { router, active, webhook, plan };
}
