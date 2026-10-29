# Upgrade implementation report — 29 October 2026

## 1. Features completed

The existing application is upgraded in place. Preserved the React/Vite/Tailwind/Recharts UI, Express/Zod API, official OpenAI SDK and SQLite. Dashboard, live capture, rules, observation review, reports and settings use persistent data or explicitly labelled deterministic mock data. No journal/CSV-import feature existed, so no fictitious trade journal or financial results were introduced.

## 2. Fixed and newly implemented

- SQLite migration v2 with exact v1 backup, owner-inclusive keys, indexed lookups, synchronous multi-record transactions, atomic/fsynced saves and process locking. Fixed settings-ID collisions across owners. Legacy event/session records remain readable; absent historical snapshots are explicitly disclosed.
- Separate `Sessions` and `Frames` services for lifecycle/report/rules and bounded asynchronous analysis. Added a durable frame ledger with latency, sanitized errors, provider/model, captured/analyzed coverage and late-completion flags.
- Idempotency covers empty successful responses, terminal errors and concurrent duplicates, rejects reused IDs with different input/session, and avoids paid replays. Browser retries only lost transport requests once with the identical frame ID; expired requests do not double their deadline.
- Idempotent stop waits for permitted work. Report regeneration retries from saved observations. Page-close notifications, heartbeat expiry, restart recovery and browser back/forward-cache handling prevent pretending a lost stream resumed.
- Separate capture/analysis intervals; latest-frame replacement queue, no overlapping sends, both-dimension resizing/JPEG compression, abortable cleanup and a late-permission-grant regression fix. Opt-in video stays bounded in browser memory and attaches only to its originating report.
- Structured rule categories/numeric limits/window context/version and immutable enabled-rule snapshots. Supported adherence, potential deviation, unknown/not-assessable and review states remain distinct.
- Persistent observation notes, original/corrected text, user revision history and status filters. Confirm/dismiss no longer silently clear earlier corrections.
- JSON/CSV exports, CSV formula neutralization, processing-history/latency details, snapshot/recurring-text summaries, title/status/local-date filters and explicit retry controls for interrupted reports.
- Configurable official Responses vision adapter, structured validation, refusal/incomplete-output handling, image detail/token/reasoning options, bounded timeout/retry/budget/concurrency and explicit safe status. Fatal key/quota/access failures pause sampling immediately; repeated failures pause after three attempts.
- Optional local workspace bearer gate, UUID/query/body validation, real bounded image decoding, Host/Origin restrictions, rate limits, production-static security headers and metadata-only audit trail.
- Explicit operator-only `ai:check` refuses to call the API without `--allow-paid`. No startup/web diagnostic incurs costs or asserts a key is valid from its presence.

## 3. Files created or modified

| Area | Files |
| --- | --- |
| Frontend modified | `src/App.tsx`, `src/api.ts`, `src/capture.ts`, `src/styles.css` |
| Frontend extracted | `src/components/Empty.tsx`, `src/components/SessionList.tsx` |
| Backend modified | `server/app.ts`, `server/db.ts`, `server/index.ts`, `server/migrate.ts`, `server/providers.ts`, `server/provider-errors.ts` |
| Backend added | `server/config.ts`, `server/sessions.ts`, `server/frames.ts` |
| Shared/config | `shared/schema.ts`, `.env.example`, `package.json`, `package-lock.json`, `vite.config.ts` |
| Operator tools | `scripts/check-ai.ts`, `scripts/smoke.mjs` |
| Tests updated/added | `tests/api.test.ts`, `tests/ui.test.tsx`, `tests/upgrade.test.ts`, `tests/capture.test.ts`, `tests/flows.test.tsx`, `tests/filters.test.tsx`, `tests/fixtures/frame.jpg`; existing provider-error tests preserved |
| Documentation | `PROJECT_STATUS.md`, `README.md`, `docs/API.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md`, this report, `docs/upgrade-report.png`, `docs/upgrade-mobile.png` |

Existing `.env` secrets were not edited. Tests used isolated databases. `sharp` is the sole new runtime dependency, justified by actual decoding/pixel-limit validation; no stack replacement occurred.

## 4. Automated tests and actual results

- Baseline: **29/29 tests passed** and production build passed before changes.
- Final: **57/57 tests passed across seven files**, with mocked HTTP/browser APIs and isolated SQLite fixtures. Coverage includes complete capture-to-review UI flow, full mock backend session/report flow, rule forms and filters, lifecycle/cancellation, queue bounds, migration/locking/rollback, authorization/rate limits, restart recovery, empty/failed idempotency, exports and malformed/incomplete AI output.
- `npm.cmd run test:smoke`: **passed** on compiled server: static page/health, bearer gate, rules/session/frame processing, idempotent replay, review, report/export, process restart persistence and deletion. Uses a temporary database and no external AI service.
- `npm.cmd audit --omit=dev`: **0 known vulnerabilities** reported by the registry at verification time. This is not a comprehensive security certification.
- `npm.cmd run ai:check` without paid flag: correctly made **no API request** and printed explicit opt-in instructions.

## 5. Production build

`npm.cmd run build`: **passed**. It type-checks application/tests, produces Vite frontend bundles and compiles server/shared modules. The compiled application starts and passes the isolated smoke test. Charts are a separate bundle.

## 6. Run locally

```powershell
cd D:\trading
npm.cmd ci
# Keep your existing .env. To test offline without editing it:
$env:AI_PROVIDER='mock'
npm.cmd run dev
```

Open http://127.0.0.1:5173. Stop any old process first. First startup migrates a v1 database with backup; `db:init` is also available with the server stopped. For the built app, set `FRONTEND_ORIGIN=http://127.0.0.1:3001`, then `npm.cmd start`. See README for clearing temporary PowerShell overrides and optional APP_ACCESS_TOKEN.

An isolated mock preview was inspected at http://127.0.0.1:3107 using a separate QA database and an explicitly labelled DEMO session. It is not the personal session database. Verified a JSON browser download and inspected desktop/390px layouts; screenshots are included. Native screen-picker approval was not automated.

## 7. Verified in mock mode

Session creation/start/frame ingestion/review/stop/report/export/delete; deterministic normal/deviation/insufficient/error/abortable-timeout behavior; actual UI forms, capture controls through mocked media APIs, frame queue/pause/resume/cleanup, notes/revision retention, category/version/snapshot behavior, settings/filtering, interrupted recovery and persistence. No financial metrics are invented. Mock findings do not interpret screen content.

## 8. Requires a valid OpenAI API key

Real vision connectivity, actual selected-model capability and account access, observed paid latency/rate behavior, and visual accuracy/adherence against labelled test screens. Earlier credentials returned 401; this upgrade made **no live API requests** and did not assume credential validity. Provider switching/construction/errors were tested with intercepted responses only.

## 9. Exact live acceptance steps

1. Obtain an active secret with access to a vision/Responses/structured-output model. Save it privately as `OPENAI_API_KEY` and set `AI_PROVIDER=openai`, `OPENAI_MODEL` in backend `.env`.
2. Stop the app. Clear a temporary `$env:AI_PROVIDER` mock override if present. Restart `npm.cmd run dev`.
3. Only when authorized to incur a small charge, run `npm.cmd run ai:check -- --allow-paid`; verify structured validation and measured latency. No successful result is fabricated.
4. Optionally test a safe screenshot with `npm.cmd run ai:check -- --allow-paid --image D:\path\to\demo.jpg`. This explicitly transmits the named image.
5. Use desktop Chrome/Edge, set a conservative interval, consent and select the synthetic Notepad/demo window. Verify real labels, successful frames, supported evidence, uncertainty and measured latency.
6. Stop, inspect report/snapshot/processing history and late flags, review/correct/annotate findings, export and reopen after restart.
7. Use the deterministic mocked invalid-key/quota/rate/timeout tests for error paths; do not deliberately exhaust paid quota. Record actual outcomes using the manual procedure in TESTING.md.

## 10. Known limitations and unresolved external verification

- Local single owner only. Optional bearer gate is not per-user authentication. Public deployment needs the work listed in DEPLOYMENT.md; none was deployed or published.
- No successful live AI accuracy/connectivity result is claimed. Chosen model must support configured image/structured/reasoning options. Screenshots cannot independently establish broker execution, account truth, losses or profitability.
- Browser/OS permission remains user-controlled. Automated tests mock native capture. Beacon delivery is best-effort; OS sleep/background throttling can affect recovery timing. Real native picker and video playback need the documented manual test.
- Video is opt-in browser memory/download only, not durable server storage. Raw evidence frames are transient; frame IDs/text cannot reopen the original screenshot. Captured counts are browser-reported and cannot establish coverage of skipped frames.
- SQLite WASM exports the file per transaction, is single-process and loads local data in memory. Larger deployments need a different repository/storage architecture; no PostgreSQL migration is implemented.
- Legacy missing snapshots/frame ledgers cannot be reconstructed. Exact repeated finding text is a report summary, not reliable behavioral pattern detection across real trades.
- Retention is manual; backups/downloaded exports/provider records need separate controls. Deletion is not forensic secure erasure.

All features within the offline/local scope are implemented and verified to the extent stated above. A working mock and passing SDK construction tests are not a fully validated AI product.
