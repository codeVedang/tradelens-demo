import { it, expect } from "vitest";
import request from "supertest";
import { serverConfig } from "../server/config";
import { Store } from "../server/db";
import { createApp } from "../server/app";
import { MockAIProvider } from "../server/providers";
const token = "test-demo-workspace-token-32-characters";
const hosted = {
  DEPLOYMENT_MODE: "hosted_demo",
  DEV_NO_AUTH: "false",
  APP_ACCESS_TOKEN: token,
  AI_PROVIDER: "mock",
  RENDER: "true",
  RENDER_EXTERNAL_URL: "https://tradelens-demo.onrender.com",
};
it("derives the Render origin and listener with an explicit hosted mode", () => {
  const c = serverConfig(hosted);
  expect(c.LISTEN_HOST).toBe("0.0.0.0");
  expect(c.FRONTEND_ORIGIN).toBe(hosted.RENDER_EXTERNAL_URL);
  expect(c.ALLOWED_HOSTS).toContain("tradelens-demo.onrender.com");
  expect(c.TRUST_PROXY_HOPS).toBe(1);
  expect(serverConfig({ DEV_NO_AUTH: "true" }).LISTEN_HOST).toBe("127.0.0.1");
});
it.each([
  { ...hosted, DEV_NO_AUTH: "true" },
  { ...hosted, APP_ACCESS_TOKEN: "" },
  { ...hosted, FRONTEND_ORIGIN: "http://demo.example" },
  { ...hosted, AI_PROVIDER: "openai" },
  { ...hosted, FRONTEND_ORIGIN: "https://demo.example/path" },
])("refuses an unsafe demo configuration", (env) => {
  expect(() => serverConfig(env)).toThrow();
});
it("permits only the configured hosted Host and Origin, gates data, and discloses shared/ephemeral mode", async () => {
  const store = await Store.open();
  try {
    const c = serverConfig(hosted),
      app = createApp(store, new MockAIProvider(), {
        origin: c.FRONTEND_ORIGIN,
        allowedHosts: c.ALLOWED_HOSTS,
        accessToken: token,
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
      .get("/api/config/status")
      .set("Host", "tradelens-demo.onrender.com")
      .set("Origin", c.FRONTEND_ORIGIN)
      .set("Authorization", "Bearer " + token)
      .expect(200);
    expect(result.body.deploymentMode).toBe("hosted_demo");
    expect(result.body.ephemeralStorage).toBe(true);
    expect(result.body.privacyNotice).toContain("Shared demo");
    expect(JSON.stringify(result.body)).not.toContain(token);
    await request(app)
      .get("/api/sessions")
      .set("Host", "attacker.example")
      .set("Authorization", "Bearer " + token)
      .expect(403);
    await request(app)
      .get("/api/sessions")
      .set("Host", "tradelens-demo.onrender.com")
      .set("X-Forwarded-Host", "attacker.example")
      .set("Origin", "https://evil.example")
      .set("Authorization", "Bearer " + token)
      .expect(403);
  } finally {
    store.close();
  }
});
