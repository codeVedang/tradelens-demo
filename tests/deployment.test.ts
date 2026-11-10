import { it, expect, vi } from "vitest";
import request from "supertest";
import { serverConfig } from "../server/config";
import { Store } from "../server/db";
import { createApp } from "../server/app";
import { MockAIProvider } from "../server/providers";
const hosted = {
  DEPLOYMENT_MODE: "hosted_demo",
  AI_PROVIDER: "mock",
  RENDER: "true",
  RENDER_EXTERNAL_URL: "https://tradelens-demo.onrender.com",
};
it("isolates expiring hosted demo accounts and revokes access on password rotation", async () => {
  const store = await Store.open();
  try {
    const c = serverConfig(hosted);
    const first = { email: "demo1@tradzyn.local", password: "a".repeat(32) };
    const second = { email: "demo2@tradzyn.local", password: "b".repeat(32) };
    const expires = Date.now() + 3600_000;
    const makeApp = (accounts: (typeof first)[], deployment = "hosted_demo") =>
      createApp(store, new MockAIProvider(), {
        origin: c.FRONTEND_ORIGIN,
        allowedHosts: c.ALLOWED_HOSTS,
        hostedDemo: deployment === "hosted_demo",
        accountEnv: {
          ...hosted,
          DEPLOYMENT_MODE: deployment,
          NODE_ENV: "production",
          HOSTED_DEMO_ACCOUNTS: JSON.stringify(accounts),
          HOSTED_DEMO_UNTIL: new Date(expires).toISOString(),
        },
      });
    const host = new URL(c.FRONTEND_ORIGIN).host;
    const app = makeApp([first, second]);
    const call = request(app);
    await call
      .get("/api/auth/me")
      .set("Host", host)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          profile: null,
          demoMode: "hosted",
          demoEnabled: true,
        });
        expect(JSON.stringify(body)).not.toContain(first.password);
      });
    await call
      .post("/api/auth/demo")
      .set("Host", host)
      .send({ ...first, password: second.password })
      .expect(401);
    const login = async (account: typeof first) => {
      const response = await call
        .post("/api/auth/demo")
        .set("Host", host)
        .send(account)
        .expect(200);
      const header = String(response.headers["set-cookie"]);
      expect(header).toMatch(
        /__Host-tradzyn_session=.*HttpOnly; Secure; SameSite=Lax/,
      );
      return header.split(";")[0];
    };
    const firstCookie = await login(first);
    const secondCookie = await login(second);
    await call
      .get("/api/billing")
      .set("Host", host)
      .set("Cookie", firstCookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ active: true, demo: true, payments: [] }),
      );
    await call
      .post("/api/sessions")
      .set("Host", host)
      .set("Cookie", firstCookie)
      .send({})
      .expect(201);
    await call
      .get("/api/sessions")
      .set("Host", host)
      .set("Cookie", secondCookie)
      .expect(200, []);
    const rotated = makeApp([{ ...first, password: "c".repeat(32) }, second]);
    await request(rotated)
      .get("/api/journal")
      .set("Host", host)
      .set("Cookie", firstCookie)
      .expect(401);
    await request(rotated)
      .get("/api/journal")
      .set("Host", host)
      .set("Cookie", secondCookie)
      .expect(200);
    const production = makeApp([first, second], "production");
    await request(production)
      .post("/api/auth/demo")
      .set("Host", host)
      .send(first)
      .expect(404);
    const now = vi.spyOn(Date, "now").mockReturnValue(expires + 1);
    try {
      await call
        .get("/api/journal")
        .set("Host", host)
        .set("Cookie", secondCookie)
        .expect(401);
      await call
        .post("/api/auth/demo")
        .set("Host", host)
        .send(first)
        .expect(404);
    } finally {
      now.mockRestore();
    }
  } finally {
    store.close();
  }
});
it("derives the Render origin and listener with an explicit hosted mode", () => {
  const c = serverConfig(hosted);
  expect(c.LISTEN_HOST).toBe("0.0.0.0");
  expect(c.FRONTEND_ORIGIN).toBe(hosted.RENDER_EXTERNAL_URL);
  expect(c.ALLOWED_HOSTS).toContain("tradelens-demo.onrender.com");
  expect(c.TRUST_PROXY_HOPS).toBe(1);
  expect(serverConfig({}).LISTEN_HOST).toBe("127.0.0.1");
});
it.each([
  { ...hosted, FRONTEND_ORIGIN: "http://demo.example" },
  { ...hosted, AI_PROVIDER: "openai" },
  { ...hosted, FRONTEND_ORIGIN: "https://demo.example/path" },
])("refuses an unsafe demo configuration", (env) => {
  expect(() => serverConfig(env)).toThrow();
});
it("permits only the configured hosted Host and Origin, requires a signed-in account", async () => {
  const store = await Store.open();
  try {
    const c = serverConfig(hosted),
      app = createApp(store, new MockAIProvider(), {
        origin: c.FRONTEND_ORIGIN,
        allowedHosts: c.ALLOWED_HOSTS,
        accountEnv: hosted,
        hostedDemo: true,
        ephemeralStorage: true,
        trustProxyHops: 1,
      });
    await request(app)
      .get("/api/health")
      .set("Host", "tradelens-demo.onrender.com")
      .expect(200);
    await request(app)
      .get("/api/sessions")
      .set("Host", "tradelens-demo.onrender.com")
      .expect(401);
    const result = await request(app)
      .get("/api/auth/me")
      .set("Host", "tradelens-demo.onrender.com")
      .set("Origin", c.FRONTEND_ORIGIN)
      .expect(200);
    expect(result.body).toEqual({
      profile: null,
      googleConfigured: false,
      demoEnabled: false,
      demoMode: null,
    });
    await request(app)
      .get("/api/sessions")
      .set("Host", "attacker.example")
      .expect(403);
    await request(app)
      .get("/api/sessions")
      .set("Host", "tradelens-demo.onrender.com")
      .set("X-Forwarded-Host", "attacker.example")
      .set("Origin", "https://evil.example")
      .expect(403);
  } finally {
    store.close();
  }
});
