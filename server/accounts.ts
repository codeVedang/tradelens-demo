import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Store } from "./db.js";
import { fail } from "./sessions.js";

export type Profile = {
  id: string;
  name: string;
  email: string;
  picture?: string;
};
type Login = { id: string; userId: string; expires: number };
type Attempt = {
  id: string;
  state: string;
  nonce: string;
  verifier: string;
  expires: number;
};
type Demo = { id: string; salt: string; hash: string };
const system = "tradzyn-auth";
const week = 7 * 86400_000;
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const cookie = (req: Request, name: string) =>
  req.headers.cookie
    ?.split(/;\s*/)
    .find((part) => part.startsWith(name + "="))
    ?.slice(name.length + 1) ?? "";

export function demoAllowed(env: NodeJS.ProcessEnv, origin: string) {
  return (
    env.NODE_ENV !== "production" &&
    (!env.DEPLOYMENT_MODE || env.DEPLOYMENT_MODE === "local") &&
    env.ENABLE_DEMO_LOGIN === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)
  );
}
export function seedDemo(store: Store) {
  const password = random(),
    salt = random();
  const profile: Profile = {
    id: "demo-local",
    name: "Tradzyn Demo",
    email: "demo@tradzyn.local",
  };
  store.transaction(() => {
    store.put("profile", profile, system);
    store.put(
      "demo_password",
      {
        id: profile.id,
        salt,
        hash: scryptSync(password, salt, 64).toString("hex"),
      },
      system,
    );
    store.put(
      "subscription",
      {
        id: "premium",
        status: "ACTIVE",
        paidThrough: new Date(Date.now() + 30 * 86400_000).toISOString(),
        demo: true,
      },
      profile.id,
    );
    if (
      !store.get("journal", "7174bf17-3abe-4fbb-81ac-974abdb153cd", profile.id)
    )
      store.put(
        "journal",
        {
          id: "7174bf17-3abe-4fbb-81ac-974abdb153cd",
          date: new Date().toISOString().slice(0, 10),
          notes: "DEMO SAMPLE — fictional journal entry",
          expectedCents: 10000,
          realCents: -2500,
        },
        profile.id,
      );
    for (const login of store.all<Login>("login", system))
      if (login.userId === profile.id) store.delete("login", login.id, system);
  });
  return { email: profile.email, password };
}

export function accounts(store: Store, env: NodeJS.ProcessEnv, origin: string) {
  const callback = origin + "/api/auth/google/callback";
  if (env.GOOGLE_CALLBACK_URL && env.GOOGLE_CALLBACK_URL !== callback)
    throw new Error(
      "GOOGLE_CALLBACK_URL must match the frontend origin plus /api/auth/google/callback",
    );
  const configured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const google = new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    callback,
  );
  const demo = demoAllowed(env, origin);
  const secure = origin.startsWith("https:");
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
  const sessionName = secure ? "__Host-tradzyn_session" : "tradzyn_session";
  const attemptName = secure ? "__Host-tradzyn_oauth" : "tradzyn_oauth";
  const router = Router();
  const loginId = (req: Request) => hash(cookie(req, sessionName));
  const profile = (req: Request) => {
    const login = store.get<Login>("login", loginId(req), system);
    if (!login || login.expires <= Date.now()) return undefined;
    if (login.userId === "demo-local" && !demo) return undefined;
    return store.get<Profile>("profile", login.userId, system);
  };
  const prune = (kind: "login" | "oauth_attempt") => {
    for (const item of store.all<Login | Attempt>(kind, system))
      if (item.expires <= Date.now()) store.delete(kind, item.id, system);
  };
  const startSession = (req: Request, res: Response, user: Profile) => {
    const token = random();
    store.transaction(() => {
      prune("login");
      store.delete("login", loginId(req), system);
      store.put("profile", user, system);
      store.put(
        "login",
        { id: hash(token), userId: user.id, expires: Date.now() + week },
        system,
      );
      store.put(
        "audit",
        {
          id: randomUUID(),
          action: "account.signed_in",
          at: new Date().toISOString(),
        },
        user.id,
      );
    });
    res.cookie(sessionName, token, { ...cookieOptions, maxAge: week });
  };
  router.get("/me", (req, res) =>
    res.json({
      profile: profile(req) ?? null,
      googleConfigured: configured,
      demoEnabled: demo,
    }),
  );
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 25,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  router.get("/google", (req, res) => {
    if (!configured) return res.redirect("/login?error=unavailable");
    const token = random();
    const attempt = {
      id: hash(token),
      state: random(),
      nonce: random(),
      verifier: random(),
      expires: Date.now() + 600_000,
    };
    store.transaction(() => {
      prune("oauth_attempt");
      store.delete("oauth_attempt", hash(cookie(req, attemptName)), system);
      store.put("oauth_attempt", attempt, system);
    });
    res.cookie(attemptName, token, { ...cookieOptions, maxAge: 600_000 });
    const query = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: callback,
      response_type: "code",
      scope: "openid email profile",
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge_method: "S256",
      code_challenge: hash(attempt.verifier),
    });
    res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + query);
  });
  router.get("/google/callback", async (req, res) => {
    const id = hash(cookie(req, attemptName));
    const attempt = store.get<Attempt>("oauth_attempt", id, system);
    if (attempt) store.delete("oauth_attempt", id, system);
    res.clearCookie(attemptName, cookieOptions);
    if (
      !configured ||
      !attempt ||
      attempt.expires <= Date.now() ||
      req.query.state !== attempt.state
    )
      return res.redirect("/login?error=oauth");
    if (req.query.error === "access_denied")
      return res.redirect("/login?error=cancelled");
    if (typeof req.query.code !== "string")
      return res.redirect("/login?error=oauth");
    try {
      const result = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: req.query.code,
          redirect_uri: callback,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          code_verifier: attempt.verifier,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) throw new Error("Token exchange failed");
      const { id_token } = z
        .object({ id_token: z.string() })
        .parse(await result.json());
      const ticket = await google.verifyIdToken({
        idToken: id_token,
        audience: env.GOOGLE_CLIENT_ID,
      });
      const payload = z
        .object({
          sub: z.string().min(1),
          email: z.email(),
          email_verified: z.literal(true),
          nonce: z.literal(attempt.nonce),
          name: z.string().optional(),
          picture: z.string().optional(),
        })
        .parse(ticket.getPayload());
      const picture = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(
        payload.picture ?? "",
      )
        ? payload.picture
        : undefined;
      startSession(req, res, {
        id: "google:" + payload.sub,
        name: payload.name || payload.email,
        email: payload.email,
        picture,
      });
      return res.redirect("/app");
    } catch {
      return res.redirect("/login?error=oauth");
    }
  });
  router.post("/demo", (req, res) => {
    if (!demo) throw fail(404, "Endpoint not found");
    const body = z
      .object({
        email: z.literal("demo@tradzyn.local"),
        password: z.string().min(1).max(256),
      })
      .parse(req.body);
    const credential = store.get<Demo>("demo_password", "demo-local", system);
    const user = store.get<Profile>("profile", "demo-local", system);
    if (
      !credential ||
      !user ||
      !timingSafeEqual(
        scryptSync(body.password, credential.salt, 64),
        Buffer.from(credential.hash, "hex"),
      )
    )
      throw fail(401, "Invalid demo credentials");
    startSession(req, res, user);
    res.json({ profile: user });
  });
  router.post("/logout", (req, res) => {
    store.delete("login", loginId(req), system);
    res.clearCookie(sessionName, cookieOptions).status(204).end();
  });
  return { router, profile };
}
