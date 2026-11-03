# Deployment

Run one Node 22 process behind HTTPS and use the same origin for UI and API. Build with `npm ci --include=dev && npm run build` and start with `npm start`. Configure `PORT`, exact `FRONTEND_ORIGIN` (or `RENDER_EXTERNAL_URL`), `TRUST_PROXY_HOPS` as appropriate, and a writable `DATABASE_PATH`. Health is `/api/health`.

`DEPLOYMENT_MODE=hosted_demo` permits only mock AI. `DEPLOYMENT_MODE=production` requires HTTPS and supports configured OpenAI. Set `NODE_ENV=production` and keep demo login disabled. Provide the credentials and redirect URI in [Authentication setup](AUTHENTICATION_SETUP.md). The public landing page works before OAuth configuration. Use [Subscription setup](SUBSCRIPTION_SETUP.md) before offering checkout.

Use durable storage for real accounts and journal data. The included Render blueprint remains a free, ephemeral demo with one service. Its SQLite data can disappear on redeploy or restart. Keep production DB backups and use only one writer per database. Configure the reporting currency before first startup. Legacy records stay under their existing ownership namespace.

Use `npm run demo:package` for a sanitized source package. The packager excludes credentials, account databases, recordings and Git history. The existing hosted service is documented in [the historical deployment record](DEPLOYED_DEMO.md). Verify the target revision and deployment separately before sharing a release URL.
