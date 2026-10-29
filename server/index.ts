import "dotenv/config";
import express from "express";
import { Store } from "./db.js";
import { createProvider } from "./providers.js";
import { createApp } from "./app.js";
import { serverConfig } from "./config.js";
const config = serverConfig(process.env),
  store = await Store.open(config.DATABASE_PATH),
  provider = createProvider(process.env);
const app = createApp(store, provider, {
  origin: config.FRONTEND_ORIGIN,
  timeoutMs: config.AI_TIMEOUT_MS,
  budget: config.AI_REQUEST_BUDGET,
  accessToken: config.APP_ACCESS_TOKEN,
  defaultIntervalSeconds: config.AI_ANALYSIS_INTERVAL_SECONDS,
  defaultCaptureIntervalSeconds: config.CAPTURE_INTERVAL_SECONDS,
  allowedHosts: config.ALLOWED_HOSTS,
  trustProxyHops: config.TRUST_PROXY_HOPS,
  hostedDemo: config.DEPLOYMENT_MODE === "hosted_demo",
  ephemeralStorage: config.DEMO_EPHEMERAL_STORAGE === "true",
});
app.locals.sessions.recover();
const recovery = setInterval(() => {
  try {
    app.locals.sessions.recover(
      "heartbeat_expired",
      Date.now() - 90000,
      (id: string, owner: string) => !!app.locals.frames.pending(id, owner),
    );
  } catch {
    console.error(JSON.stringify({ event: "recovery.failed" }));
  }
}, 15000);
recovery.unref();
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
});
app.use(express.static("dist", { dotfiles: "deny" }));
app.get("/{*path}", (_req, res) =>
  res.sendFile("index.html", { root: "dist" }),
);
const server = app.listen(config.PORT, config.LISTEN_HOST, () =>
  console.info(
    `TradeLens: http://127.0.0.1:${config.PORT} (${provider.mode}; connection unverified)`,
  ),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(recovery);
  server.close();
  await Promise.allSettled([...app.locals.frames.inflight.values()]);
  app.locals.sessions.recover("server_shutdown");
  store.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
