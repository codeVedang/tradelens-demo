import { z } from "zod";
export function serverConfig(env: NodeJS.ProcessEnv) {
  const hosted =
    env.DEPLOYMENT_MODE === "hosted_demo" ||
    env.DEPLOYMENT_MODE === "production";
  const config = z
    .object({
      DEPLOYMENT_MODE: z
        .enum(["local", "hosted_demo", "production"])
        .default("local"),
      DEMO_EPHEMERAL_STORAGE: z.enum(["true", "false"]).default("false"),
      TRUST_PROXY_HOPS: z.coerce
        .number()
        .int()
        .min(0)
        .max(2)
        .default(env.RENDER === "true" ? 1 : 0),
      PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
      FRONTEND_ORIGIN: z.url().default("http://127.0.0.1:5173"),
      DATABASE_PATH: z.string().default("data/coach.sqlite"),
      AI_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(100)
        .max(120000)
        .default(60000),
      AI_REQUEST_BUDGET: z.coerce.number().int().min(1).max(1000).default(100),
      AI_ANALYSIS_INTERVAL_SECONDS: z.coerce
        .number()
        .int()
        .min(5)
        .max(120)
        .default(5),
      CAPTURE_INTERVAL_SECONDS: z.coerce
        .number()
        .int()
        .min(1)
        .max(30)
        .default(1),
    })
    .parse({
      ...env,
      FRONTEND_ORIGIN:
        env.FRONTEND_ORIGIN || (hosted ? env.RENDER_EXTERNAL_URL : undefined),
    });
  if (config.CAPTURE_INTERVAL_SECONDS > config.AI_ANALYSIS_INTERVAL_SECONDS)
    throw new Error("Capture interval cannot exceed analysis interval");
  const origin = new URL(config.FRONTEND_ORIGIN);
  if (origin.origin !== config.FRONTEND_ORIGIN)
    throw new Error(
      "FRONTEND_ORIGIN must be an exact origin without path, credentials or trailing slash",
    );
  if (hosted) {
    if (origin.protocol !== "https:")
      throw new Error(
        "Hosted deployment requires an HTTPS FRONTEND_ORIGIN (Render supplies RENDER_EXTERNAL_URL)",
      );
    if (
      config.DEPLOYMENT_MODE === "hosted_demo" &&
      (env.AI_PROVIDER ?? "mock") !== "mock"
    )
      throw new Error(
        "Hosted demo is restricted to mock AI; use local or production mode for real AI",
      );
  }
  const allowedHosts = ["127.0.0.1", "localhost", "[::1]", "::1"];
  if (hosted) {
    allowedHosts.push(origin.hostname);
    if (env.RENDER_EXTERNAL_URL)
      allowedHosts.push(new URL(env.RENDER_EXTERNAL_URL).hostname);
  }
  return {
    ...config,
    LISTEN_HOST: hosted ? "0.0.0.0" : "127.0.0.1",
    ALLOWED_HOSTS: allowedHosts,
  };
}
