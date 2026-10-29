# Project status — upgrade audit (29 October 2026)

## Baseline audit

Existing React/Vite/TypeScript/Tailwind/Recharts, Express/Zod, sql.js SQLite and official OpenAI SDK are preserved. Reviewed frontend navigation/forms/report/capture, all server routes/providers/storage, shared schemas, environment **variable names only**, scripts, documentation and existing tests. Existing `.env` and personal database are not test fixtures and will not be overwritten. Baseline verification completed: 29/29 tests and production build passed before changes.

| Area | Before upgrade |
| --- | --- |
| Dashboard/history | Real persisted session counts; no financial data fabricated; missing filters |
| Native capture | Consent, permission picker, selected-frame sampling, pause/stop; missing pagehide/heartbeat recovery and robust cancellation |
| Video | Explicit opt-in, bounded browser-memory download; no server video storage |
| AI | Deterministic mock and Responses SDK adapter, validated output, sanitized errors; no live success established |
| Frame processing | Single-session concurrency and budget; event-based dedup misses empty results; no durable frame ledger/latency; stale/late results insufficiently distinguished |
| Rules | Working text CRUD/enable/disable; no structured categories, version or immutable session snapshot |
| Review | Working confirmations/corrections and revision history; no event notes/history inspector |
| Reports | Persisted deterministic summaries; stop/report races, no export, missing processing ledger and recurring findings |
| Storage | Real SQLite file, atomic replacement per write; no multi-record transactions; primary key excludes owner and can collide (especially settings) |
| Security | Owner lookups, Origin checks, size/rate limits, sanitized errors; local-only identity; incomplete Host/parameter validation and audit trail |
| Journal/import | No existing trade journal or CSV-import feature; no real trades will be invented |

## Prioritized implementation checklist

- [x] Preserve old database with versioned migration backup; owner-inclusive keys, indexed lookups, atomic transactions and backward-compatible record upgrades.
- [x] Modular session/report and frame-analysis services; persistent processing ledger, safe idempotency including empty results/errors, immutable rule snapshots, latency/errors, late-result labeling.
- [x] Idempotent finalization, heartbeat expiry/restart recovery and best-effort page-close finalization.
- [x] Bound capture requests/memory, abortable cleanup, safe transport retries, stale-result protection, separate capture/analysis intervals and accurate coverage counters.
- [x] Structured rules/categories/versions and assessment distinctions; persistent event notes and inspectable review history.
- [x] JSON/CSV report exports, processing diagnostics, evidence and recurring observation summaries; working date/status/search filters.
- [x] Model/input configuration, safe missing-key behavior and explicit operator-only, opt-in paid vision diagnostic; no automatic paid probes.
- [x] Harden API ownership, parameter/query validation, Host/Origin checks, optional local bearer gate and metadata-only audit logging.
- [x] Expand deterministic backend/frontend/integration tests; verify production build and isolated startup; update API, manual verification and deployment documentation.

## Work possible offline

All application features, schema migrations, authorization boundaries, UI flows, exports, diagnostics construction, retry/timeout behavior and restart recovery can be implemented and tested locally with deterministic fixtures and intercepted SDK HTTP calls.

## External verification

An active key with model access is required to verify real vision output, paid request latency and accuracy. Earlier checks returned `401 invalid_api_key`; no successful real AI analysis has been demonstrated. This upgrade does not re-test credentials or incur paid costs. A working mock or intercepted SDK response is not proof of live AI quality. Native browser permission must remain user-controlled; automated tests mock it.

## Final verification

Completed: 57/57 tests across seven files passed; final production build passed; compiled startup/restart smoke test passed; runtime dependency audit reported 0 known vulnerabilities. Explicit AI check without --allow-paid made no request. Desktop and 390px browser layouts plus JSON download were verified using an isolated mock database. Existing .env was not edited. No paid API requests or public deployment occurred.

See [implementation report](docs/IMPLEMENTATION_REPORT.md) for files, exact commands, test evidence, live acceptance steps and limits. The native picker/real vision accuracy/latency remain manual/external verification; no live AI success is claimed.
