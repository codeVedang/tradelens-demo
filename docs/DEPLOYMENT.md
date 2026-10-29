# Deployment boundary and operational requirements

This release is a **local, single-owner application**, with production-oriented validation, lifecycle handling, persistence and tests. It has no user accounts/OIDC/password sessions and is not certified for public deployment or regulated financial use.

A limited **shared presentation demo** is supported via `DEPLOYMENT_MODE=hosted_demo`: mandatory workspace token, HTTPS origin, explicit hostname allowlist, and mock-only AI. The Render Blueprint uses the Free plan with an explicit disposable-data warning. This does not enable public multi-user or paid AI operation. Follow [HOSTED_DEMO.md](HOSTED_DEMO.md) for the exact setup; no hosting account or paid plan is created automatically.

## Built local operation

```powershell
npm.cmd ci
npm.cmd run build
# Stop the existing server before migration:
npm.cmd run db:init
$env:FRONTEND_ORIGIN='http://127.0.0.1:3001'
npm.cmd start
```

The backend serves static bundles and API from loopback port 3001. Keep `.env`, `data/`, backups and process lock files out of source control. Use one server process per database. Persist the data directory on a local disk; do not share it across replicas/network mounts. Stop the server for file backups and migrations. Schema v1→v2 is transactional and makes an exact pre-v2 backup. Do not restore that backup over a live process. PostgreSQL adoption would require a normalized repository/migration plan and tested isolation; changing an environment URL alone is insufficient.

## Optional local access gate

Set `DEV_NO_AUTH=false` and a random `APP_ACCESS_TOKEN` of at least 24 characters in backend configuration. The UI requests this separate token after API 401, holds it only in memory, and clears it on reload. All API endpoints except minimal health require the bearer token. Exports and destructive/retention operations are gated too. Never reuse an OpenAI key as a workspace token. Token rotation means updating the backend and restarting; reload/unlock each browser afterward. This is a local shared-secret gate, not separate user identities or full production authentication.

## Before public or multi-user hosting

Implement trusted authentication/identity and enforce per-user owner resolution; TLS termination and secure transport; account/session revocation and credential rotation; CSRF protection appropriate to the chosen authentication mechanism; trusted reverse-proxy configuration and domain Host/Origin policies; access/audit review and controlled administration; persistent transactional storage suitable for the workload; encrypted storage/backups and retention processes; dependency/security review, load tests, provider budgets/monitoring and incident handling. Do not simply remove loopback/Host restrictions or publish a tunnel.

Production static responses include CSP/anti-framing/no-referrer/nosniff headers. Vite development requires a different script/HMR policy and must remain local. Rate limits use process memory and would need a shared store for multiple API workers. No automatic deployment, external publication or paid API test is included in this release.

## Privacy/operations

App retention is manual and removes stopped session data and expired audit metadata. Copies in pre-migration/OS backups, downloads and the AI provider are outside that operation. Raw images are transient; persisted evidence text may still identify a person/account. `store:false` is not a promise of zero provider retention. Use a privacy-approved provider/account and avoid sensitive trading screens during testing. A server/OS crash may lose a pending frame or the in-memory opt-in video; reports mark interrupted work rather than fabricating coverage. Browser suspension/background throttling can affect heartbeat expiry.
