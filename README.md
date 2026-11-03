# Tradzyn

Tradzyn is a trading journal and performance dashboard with an optional Premium screen companion. The journal and its analytics are free for signed-in users. Expected and real P&L are entered manually.

## Run locally

Use Node.js 22.12 or later in the 22.x line.

```powershell
cd D:\trading
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:5173/ in desktop Chrome or Edge. The root is public. Login and Sign Up use the same Google flow. Signed-in users go to `/app`.

Use `.env.example` for available configuration. If `.env` already exists, add the variables you need without replacing existing values. Use `AI_PROVIDER=mock` for deterministic testing. To enable a local Premium test account, follow [Authentication setup](docs/AUTHENTICATION_SETUP.md).

The journal uses one configured reporting currency for the database. The dashboard calculates difference as **Real P&L minus Expected P&L** and groups trend points by journal date. The default is INR. Set `REPORTING_CURRENCY` before initial startup against a new database.

## Privacy and AI

Screen capture is opt-in and requires a supported secure context, typically HTTPS or loopback. Selected images go to the server for analysis and are processed transiently. Mock mode uses labeled fixtures and does not interpret the screen. Real mode sends selected images to OpenAI. An optional local video is kept in browser memory up to 100 MB. Session metadata, evidence, notes and reports persist until deleted or cleaned up. Use a synthetic window for tests.

For live AI, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and a vision model via `OPENAI_MODEL` on the backend, then restart. A missing key falls back to labeled mock mode. A configured but rejected key produces a visible provider error. The explicit `npm.cmd run ai:check -- --allow-paid` diagnostic can incur a charge.

## Project guides

- [Authentication and local demo](docs/AUTHENTICATION_SETUP.md)
- [Subscription and payment adapter](docs/SUBSCRIPTION_SETUP.md)
- [Testing, including native screen sharing](docs/TESTING.md)
- [Deployment](docs/DEPLOYMENT.md)
- [API reference](docs/API.md)
- [Status](PROJECT_STATUS.md) and [implementation report](docs/IMPLEMENTATION_REPORT.md)
