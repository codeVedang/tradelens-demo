import { createHmac, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import request from "supertest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedDemo } from "../server/accounts.js";
import { createApp } from "../server/app.js";
import type { BillingEvent, PaymentProvider } from "../server/billing.js";
import { Store } from "../server/db.js";
import { createProvider, MockAIProvider } from "../server/providers.js";

const env = {
  ENABLE_DEMO_LOGIN: "true",
  GOOGLE_CLIENT_ID: "fixture-client",
  GOOGLE_CLIENT_SECRET: "fixture-secret",
  PREMIUM_PRICE_LABEL: "Fixture price",
  PREMIUM_BILLING_PERIOD: "Fixture period",
};
let store: Store;
beforeEach(async () => {
  store = await Store.open();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  store.close();
});
function setup(options: NodeJS.ProcessEnv = env, gateway?: PaymentProvider) {
  return createApp(store, new MockAIProvider(), {
    accountEnv: options,
    paymentProvider: gateway,
  });
}
async function googleLogin(app: ReturnType<typeof setup>, sub: string) {
  const agent = request.agent(app);
  const begin = await agent.get("/api/auth/google").expect(302);
  const redirect = new URL(begin.headers.location);
  expect(redirect.hostname).toBe("accounts.google.com");
  expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
  expect(redirect.searchParams.get("redirect_uri")).toBe(
    "http://127.0.0.1:5173/api/auth/google/callback",
  );
  const state = redirect.searchParams.get("state");
  const nonce = redirect.searchParams.get("nonce");
  const exchange = vi.fn(
    async () => new Response(JSON.stringify({ id_token: "fixture-token" })),
  );
  vi.stubGlobal("fetch", exchange);
  const verify = vi
    .spyOn(OAuth2Client.prototype, "verifyIdToken")
    .mockResolvedValue({
      getPayload: () => ({
        sub,
        nonce,
        email: sub + "@example.test",
        email_verified: true,
        name: "Test trader",
      }),
    } as never);
  const callback = await agent
    .get("/api/auth/google/callback")
    .query({ state, code: "fixture-code" })
    .expect(302);
  expect(callback.headers.location).toBe("/app");
  expect(String(callback.headers["set-cookie"])).toContain("HttpOnly");
  expect(verify).toHaveBeenCalledWith({
    idToken: "fixture-token",
    audience: env.GOOGLE_CLIENT_ID,
  });
  expect(exchange).toHaveBeenCalledOnce();
  expect(
    await agent
      .get("/api/auth/google/callback")
      .query({ state, code: "fixture-code" })
      .then((r) => r.headers.location),
  ).toBe("/login?error=oauth");
  verify.mockRestore();
  vi.unstubAllGlobals();
  return agent;
}
it("uses Google subject for registration and repeat sign-in, persists sessions, and revokes on logout", async () => {
  const app = setup();
  await request(app).get("/api/public/plan").expect(200);
  await request(app).get("/api/journal").expect(401);
  await request(app)
    .get("/api/sessions")
    .set("Authorization", "Bearer old-token")
    .expect(401);
  const a = await googleLogin(app, "first");
  const b = await googleLogin(app, "first");
  expect(store.all("profile", "tradzyn-auth")).toHaveLength(1);
  const me = await a.get("/api/auth/me").expect(200);
  expect(me.body.profile).toMatchObject({
    id: "google:first",
    email: "first@example.test",
  });
  await b
    .get("/api/auth/me")
    .expect(200)
    .expect(({ body }) => expect(body.profile.id).toBe("google:first"));
  await a
    .post("/api/auth/logout")
    .set("Origin", "https://evil.example")
    .expect(403);
  await a.post("/api/auth/logout").expect(204);
  await a.get("/api/journal").expect(401);
  await b.get("/api/journal").expect(200);
});
it("rejects mismatched state and handles cancellation without exchanging a code", async () => {
  const app = setup(),
    agent = request.agent(app);
  const outbound = vi.fn();
  vi.stubGlobal("fetch", outbound);
  await agent.get("/api/auth/google").expect(302);
  await agent
    .get("/api/auth/google/callback?state=forged&code=fake")
    .expect(302)
    .expect("Location", "/login?error=oauth");
  const flow = await agent.get("/api/auth/google").expect(302);
  const state = new URL(flow.headers.location).searchParams.get("state");
  await agent
    .get("/api/auth/google/callback")
    .query({ state, error: "access_denied" })
    .expect(302)
    .expect("Location", "/login?error=cancelled");
  expect(outbound).not.toHaveBeenCalled();
  await request(setup({}))
    .get("/api/auth/google")
    .expect(302)
    .expect("Location", "/login?error=unavailable");
});
it("allows signed-in free users to manage journal entries and isolates data by owner", async () => {
  const app = setup();
  const a = await googleLogin(app, "alpha"),
    b = await googleLogin(app, "beta");
  const draft = {
    date: "2026-10-31",
    notes: "Review exit",
    expected: "32.15",
    real: "-9.25",
  };
  for (const invalid of [
    { date: "2026-02-30" },
    { expected: "NaN" },
    { real: "2.123" },
  ])
    await a
      .post("/api/journal")
      .send({ ...draft, ...invalid })
      .expect(400);
  const row = (await a.post("/api/journal").send(draft).expect(201)).body;
  expect(row).toMatchObject({ expectedCents: 3215, realCents: -925 });
  await b.get("/api/journal").expect(200, []);
  await b
    .put("/api/journal/" + row.id)
    .send(draft)
    .expect(404);
  await b.delete("/api/journal/" + row.id).expect(404);
  await a
    .put("/api/journal/" + row.id)
    .send({ ...draft, notes: "Edited", real: "2.00" })
    .expect(200);
  await a
    .get("/api/journal?q=edited&from=2026-10-31&to=2026-10-31")
    .expect(200)
    .expect(({ body }) => expect(body).toHaveLength(1));
  await a
    .get("/api/journal/analytics")
    .expect(200)
    .expect(({ body }) =>
      expect(body).toMatchObject({
        currency: "INR",
        count: 1,
        differenceCents: -3015,
        positive: 1,
        negative: 0,
      }),
    );
  await a.post("/api/sessions").send({}).expect(403);
  await a.get("/api/rules").expect(404);
  await a.delete("/api/journal/" + row.id).expect(204);
  await a.get("/api/journal").expect(200, []);
});
it("groups daily results and exports only the signed-in user's matching journal entries", async () => {
  const app = setup();
  const a = await googleLogin(app, "exporter");
  const b = await googleLogin(app, "another");
  await request(app).get("/api/journal/export").expect(401);
  await a
    .post("/api/journal")
    .send({
      date: "2026-10-30",
      expected: "10",
      real: "-1.25",
      notes: '=SUM(1,2) "QA"\nsecond line',
    })
    .expect(201);
  await a
    .post("/api/journal")
    .send({
      date: "2026-10-30",
      expected: "20",
      real: "4.50",
      notes: "Second entry",
    })
    .expect(201);
  await a
    .post("/api/journal")
    .send({
      date: "2026-10-31",
      expected: "5",
      real: "0",
      notes: "Different day",
    })
    .expect(201);
  await b
    .post("/api/journal")
    .send({
      date: "2026-10-30",
      expected: "10",
      real: "10",
      notes: "Other user's data",
    })
    .expect(201);
  const analytics = await a.get("/api/journal/analytics").expect(200);
  expect(analytics.body.trend[0]).toMatchObject({
    date: "2026-10-30",
    entryCount: 2,
    expectedCents: 3000,
    realCents: 325,
    differenceCents: -2675,
  });
  const exported = await a
    .get("/api/journal/export?from=2026-10-30&to=2026-10-30&q=QA")
    .expect(200);
  expect(exported.headers["content-disposition"]).toContain(
    "tradzyn-journal.csv",
  );
  expect(exported.text).toContain(
    '"2026-10-30","INR",10,-1.25,-11.25,"\'=SUM(1,2) ""QA""\nsecond line"',
  );
  expect(exported.text).not.toMatch(
    /Other user's data|Second entry|Different day/,
  );
});
it("seeds an isolated active demo account and rejects its cookies and password in production", async () => {
  const demo = seedDemo(store),
    agent = request.agent(setup());
  await agent
    .post("/api/auth/demo")
    .send({ ...demo, password: "bad" })
    .expect(401);
  const login = await agent.post("/api/auth/demo").send(demo).expect(200);
  await agent
    .get("/api/billing")
    .expect(200)
    .expect(({ body }) =>
      expect(body).toMatchObject({ active: true, demo: true }),
    );
  await agent.post("/api/sessions").send({}).expect(201);
  const production = setup({ ...env, NODE_ENV: "production" });
  await request(production).post("/api/auth/demo").send(demo).expect(404);
  await request(production)
    .get("/api/journal")
    .set("Cookie", login.headers["set-cookie"][0].split(";")[0])
    .expect(401);
  seedDemo(store);
  await agent.get("/api/journal").expect(401);
});
it("requires a verified payment, handles out-of-order retries, and locks expired or failed subscriptions", async () => {
  const sign = (data: string | Buffer) =>
    createHmac("sha256", "synthetic-test-key").update(data).digest();
  let checkoutId = "";
  const gateway: PaymentProvider = {
    async createCheckout(checkout) {
      checkoutId = checkout.checkoutId;
      return { url: "https://checkout.example.test/pay" };
    },
    async verifyEvent(raw, headers) {
      const signature = Buffer.from(
        String(headers["x-test-signature"] || ""),
        "hex",
      );
      const expected = sign(raw);
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected)
      )
        throw new Error("bad signature");
      return JSON.parse(raw.toString()) as BillingEvent;
    },
  };
  const app = setup(env, gateway),
    agent = await googleLogin(app, "subscriber");
  await agent
    .post("/api/billing/checkout")
    .send({ owner: "forged" })
    .expect(200);
  await agent.post("/api/sessions").send({}).expect(403);
  const webhook = (event: BillingEvent, verified = true) => {
    const body = JSON.stringify(event);
    return request(app)
      .post("/api/billing/webhook")
      .type("json")
      .set("X-Test-Signature", verified ? sign(body).toString("hex") : "forged")
      .send(body);
  };
  const pending: BillingEvent = {
    id: "pending",
    checkoutId,
    status: "PAYMENT_PENDING",
    eventAt: "2025-01-01T00:00:00.000Z",
  };
  const active: BillingEvent = {
    ...pending,
    id: "paid",
    status: "ACTIVE",
    eventAt: "2025-01-02T00:00:00.000Z",
    paidThrough: new Date(Date.now() + 86400_000).toISOString(),
    paymentReference: "fixture-payment",
  };
  await webhook(active, false).expect(400);
  await webhook(pending).expect(204);
  await agent.post("/api/sessions").send({}).expect(403);
  await webhook(active).expect(204);
  await webhook(active).expect(204);
  await webhook({ ...pending, id: "older-failure", status: "FAILED" }).expect(
    204,
  );
  const session = (await agent.post("/api/sessions").send({}).expect(201)).body;
  await agent
    .post("/api/sessions/" + session.id + "/start")
    .send({})
    .expect(200);
  await agent
    .get("/api/billing")
    .expect(200)
    .expect(({ body }) => expect(body.payments).toHaveLength(1));
  await webhook({
    ...active,
    id: "expired",
    eventAt: "2025-01-03T00:00:00.000Z",
    paidThrough: "2025-01-04T00:00:00.000Z",
  }).expect(204);
  await agent
    .get("/api/billing")
    .expect(200)
    .expect(({ body }) => expect(body.status).toBe("EXPIRED"));
  await agent.post("/api/sessions").send({}).expect(403);
  await agent
    .post("/api/sessions/" + session.id + "/frames")
    .send({})
    .expect(403);
  await agent
    .post("/api/sessions/" + session.id + "/stop")
    .send({})
    .expect(200);
  await webhook({
    ...pending,
    id: "failed",
    status: "FAILED",
    eventAt: "2025-01-05T00:00:00.000Z",
  }).expect(204);
  await agent.post("/api/sessions").send({}).expect(403);
  await agent.get("/api/journal").expect(200);
});
it("grants temporary Premium only to named authenticated testers and expires it without changing billing records", async () => {
  const expires = Date.now() + 86400_000;
  const app = setup({
    ...env,
    NODE_ENV: "production",
    PREMIUM_TEST_EMAILS: " TESTER@example.test ",
    PREMIUM_TEST_UNTIL: new Date(expires).toISOString(),
  });
  const tester = await googleLogin(app, "tester");
  const other = await googleLogin(app, "other");
  await request(app)
    .post("/api/sessions")
    .send({ email: "tester@example.test" })
    .expect(401);
  await other
    .post("/api/sessions")
    .send({ email: "tester@example.test", testAccess: true })
    .expect(403);
  await tester
    .get("/api/billing")
    .expect(200)
    .expect(({ body }) => {
      expect(body).toMatchObject({
        active: true,
        testAccess: true,
        status: "FREE",
        payments: [],
      });
    });
  const session = (await tester.post("/api/sessions").send({}).expect(201))
    .body;
  await tester
    .post("/api/sessions/" + session.id + "/start")
    .send({})
    .expect(200);
  expect(store.all("subscription", "google:tester")).toEqual([]);
  vi.spyOn(Date, "now").mockReturnValue(expires + 1);
  await tester
    .get("/api/billing")
    .expect(200)
    .expect(({ body }) =>
      expect(body).toMatchObject({ active: false, testAccess: false }),
    );
  await tester.post("/api/sessions").send({}).expect(403);
  await tester
    .post("/api/sessions/" + session.id + "/stop")
    .send({})
    .expect(200);
  await tester.get("/api/journal").expect(200);
});
it("requires an explicit valid expiry when tester emails are configured", () => {
  expect(() =>
    setup({ ...env, PREMIUM_TEST_EMAILS: "tester@example.test" }),
  ).toThrow();
  expect(() =>
    setup({
      ...env,
      PREMIUM_TEST_EMAILS: "*",
      PREMIUM_TEST_UNTIL: "2026-11-19T23:59:59Z",
    }),
  ).toThrow();
});
it("falls back to labelled mock AI when no real key is configured", () => {
  expect(createProvider({ AI_PROVIDER: "openai" }).mode).toBe("mock");
});
