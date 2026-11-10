# Tradzyn API

Use same-origin requests. Authenticated requests carry the HttpOnly session cookie. Resource IDs and owner-scoped lookups prevent cross-account access. The public application pages are `/`, `/login`, and `/signup`. Protected pages are under `/app`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/health | Public health check |
| GET | /api/public/plan | Public Premium display metadata |
| GET | /api/auth/me | Identity and available sign-in options |
| GET | /api/auth/google and /api/auth/google/callback | Google authorization and callback |
| POST | /api/auth/demo | Local seeded login or configured, expiring HTTPS hosted demo credentials |
| POST | /api/auth/logout | Revoke cookie session |
| GET, POST | /api/journal | Filtered list and create |
| GET | /api/journal/export | Download own journal as CSV using the same search and date filters |
| PUT, DELETE | /api/journal/:id | Edit or delete own entry |
| GET | /api/journal/analytics | Backend totals, daily trends, outcomes and recent entries |
| GET | /api/billing | Own status, paid-through date and payment history |
| POST | /api/billing/checkout, /api/billing/manage | Gateway redirect when configured |
| POST | /api/billing/webhook | Raw signed gateway notification |
| GET, PUT | /api/config/status, /api/settings | Analysis configuration and own preferences |
| POST | /api/retention/cleanup | Delete expired stopped sessions |
| GET, POST | /api/sessions | Premium session list and create |
| POST | /api/sessions/:id/start, /heartbeat, /frames, /stop | Capture lifecycle |
| GET | /api/sessions/:id, /events, /processing, /report, /export | Session evidence and reporting |
| PATCH, DELETE | /api/sessions/:id | Notes and deletion |
| POST | /api/events/:id/feedback | Review, correction or dismissal |

Journal input is `{date, notes, expected, real}`. Dates are ISO calendar dates. Monetary values are signed decimal strings with up to two fractional digits. Storage and analytics return integer cents in the database's configured currency. List filters are `q`, `from`, and `to`.

Frame inputs retain UUID idempotency, bounded JPEG/WebP decoding, server budgets and concurrency limits. Findings retain visible evidence, uncertainty, timestamps, review history and simulated labels. Full recordings are not uploaded. Authentication failures return 401, entitlement or request origin failures 403 and inaccessible resources 404. Owner-only cleanup remains available after entitlement loss.
