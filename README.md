# TradeLens — Trading Performance Coach

An upgraded, testable local application for screen-session review and trading discipline. Preserves React/Vite/TypeScript/Tailwind/Recharts, Express/Zod, SQLite (`sql.js`) and the official OpenAI SDK. No broker passwords, order execution, signals, price predictions or fabricated profitability metrics.

**Hosted presentation demo:** a token-protected, mock-only Render setup is now included. See [HOSTED_DEMO.md](docs/HOSTED_DEMO.md). The free plan uses disposable SQLite storage and may sleep/reset; no cloud deployment or paid storage is claimed. The local OpenAI configuration is unchanged.

**Status:** all offline workflows are implemented; real vision quality/latency remains unverified. Earlier credential checks returned `401 invalid_api_key`. This upgrade makes no paid API calls and does not modify the existing `.env` or personal database. A valid key and user-operated screen picker are needed for final live acceptance. See [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Install and run

Requires Node 22.14+ and npm. Use PowerShell in `D:\trading`:

```powershell
npm.cmd ci
# Fresh checkout only; do not overwrite an existing .env:
Copy-Item .env.example .env
# Stop any existing server before migration:
npm.cmd run db:init
npm.cmd run dev
```

Open **http://127.0.0.1:5173** in desktop Chrome/Edge. API binds to **127.0.0.1:3001**. `dev` starts direct Node children without depending on `cmd.exe`; `dev:client` / `dev:server` are also available. Vite proxies `/api` to the configured backend port and refuses to silently change frontend ports. Keep `FRONTEND_ORIGIN` equal to the exact frontend origin. No separate frontend environment file is necessary.

To test offline without altering a saved `.env`:

```powershell
$env:AI_PROVIDER='mock'
npm.cmd run dev
```

PowerShell environment variables take precedence over `.env`. To return to the `.env` provider, stop the app and run `Remove-Item Env:AI_PROVIDER` in that terminal before restarting. Do not run multiple server instances against one SQLite file; a process lock prevents simultaneous writers.

## Verify and build

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:smoke
```

Tests need no API key. The smoke test launches the compiled application with mock AI, a temporary database and local bearer gate, verifies HTTP/session/frame/report/export flows, restarts to check persistence, and cleans up only its own temporary data. Build first. `test:watch` is available during development.

To run the built frontend and backend together:

```powershell
$env:FRONTEND_ORIGIN='http://127.0.0.1:3001'
npm.cmd start
```

Open **http://127.0.0.1:3001**. These are optimized production bundles; this configuration is still a local, single-owner application rather than a public multi-user service. Never expose the Vite dev server externally.

## Functional workflow

1. Add categorized rules with optional numeric limits/time-window context. Rules are versioned; enabled rules are snapshotted when a session starts. Later edits/deletions do not rewrite history.
2. Open Live coach, read the recording/provider disclosure, consent and select a source in the browser's native picker. No automatic capture or permission bypass exists.
3. Capture is sampled separately from AI analysis: defaults are 1-second capture and 5-second analysis. Images are resized to at most 1280 pixels on either dimension, compressed to JPEG and bounded in size. One latest frame can be retained while one request runs; busy intervals are skipped.
4. A persistent frame ledger records successful/failed analyses, latency, timestamps, provider/model and errors without storing raw images. Repeating a frame ID does not repeat AI work or findings, including empty results and terminal failures. Reusing an ID with different input is rejected.
5. Pause suspends sampling and MediaRecorder where available; screen sharing remains active and the wall-clock timer includes paused time. Resume continues. Fatal credential/quota/model errors or three consecutive failures pause analysis automatically.
6. Stop ends capture, finalizes metadata and awaits bounded in-flight work. Findings completed after the stop are explicitly labelled as report-only late results. Repeated stop is safe. A report can be retried from persisted events without rerunning AI.
7. Confirm, dismiss, correct or annotate observations. Original text, qualitative uncertainty, evidence IDs/timestamps, provider labels and correction history remain inspectable. No model confidence is treated as calibrated probability.
8. Reports contain capture/submission/analysis counts, start/end/recovery reason, failures/latency, rule snapshots, exact repeated observation text within the session, notes and review groups. JSON exports preserve the report; CSV exports contain observations only and neutralize formula-leading cells.
9. Session history supports title search, status and local-date filters. Charts show actual stored analysis counts, not financial performance. Empty/loading/error states explain what is available.

### Capture lifecycle and interruptions

The page sends heartbeats every 10 seconds and attempts a close notification through `sendBeacon` (or authenticated `keepalive` fetch). Closing/reloading a tab stops its stream; a lost stream cannot be resumed. The server checks abandoned sessions every 15 seconds and finalizes those without a heartbeat for 90 seconds, unless permitted analysis is still in flight. Startup recovers interrupted recording/frame metadata and generates a report. Beacon delivery is best-effort; browser crashes, OS sleep and background timer throttling can delay or prematurely trigger expiry. Session reports show the recovery reason, and the UI offers finalization/report retry for interrupted sessions.

The browser reports captured-frame counts; the server cannot independently verify skipped frames. Submitted/analyzed counts are server recorded. Frames that fail analysis have no AI coverage. Late completions are not represented as live detections.

### Optional local video

MediaRecorder is used where supported. Full video is not retained by default; chunks are discarded. Enable local video before capture to keep up to 100 MB in browser memory and download after stopping. Exceeding the cap discards the video, while coaching continues. Navigating away/reloading loses the memory video. Downloads are outside application deletion controls. No full recording is sent to AI or persisted on the server. Unsupported MediaRecorder falls back to frame-only coaching.

## OpenAI setup and explicit connection test

Keep all secrets in the backend/root `.env`, never in `VITE_` variables, source files or browser storage. Set:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-complete-api-secret
OPENAI_MODEL=gpt-4.1-mini
AI_TIMEOUT_MS=60000
AI_MAX_OUTPUT_TOKENS=4096
AI_MAX_RETRIES=1
AI_IMAGE_DETAIL=auto
# Optional, only if supported by the selected model:
AI_REASONING_EFFORT=
```

`gpt-4.1-mini` is an inexpensive example, not a validated best model or a restriction. Preserve your selected vision-capable model if it supports Responses and structured outputs. The adapter uses official SDK `responses.create`, `input_image` and `zodTextFormat`, checks refusal/incomplete statuses, and Zod-validates parsed output before storage. It does not assume image/structured-output/reasoning compatibility from a model name alone: actual capability is checked by the explicit test below. See [official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) and [official model documentation](https://developers.openai.com/api/docs/models/gpt-5.5).

Restart the backend after editing. An OpenAI mode label or key presence is **not** credential validation. Explicit OpenAI mode with no key fails startup safely; an unspecified provider defaults to mock even without credentials. A real provider failure never silently becomes mock output.

An explicit operator command makes **one** real vision request, with retries disabled:

```powershell
npm.cmd run ai:check
# Above prints instructions only. To authorize a potentially paid synthetic-image request:
npm.cmd run ai:check -- --allow-paid
# Optional non-sensitive local screenshot; explicitly uploads that image:
npm.cmd run ai:check -- --allow-paid --image D:\path\to\demo.jpg
```

Success reports model, measured latency, observation count and structured validation, without printing image content or credentials. It does not certify trading-analysis accuracy. The check is operator-only, not an unauthenticated web endpoint. There are no automatic connectivity probes. In regular capture, an accepted analysis attempt can use up to two upstream requests (one SDK retry); a session request budget counts attempts, not a dollar spending cap. The outer timeout bounds the whole provider call. A browser transport retry uses the same frame ID and does not duplicate accepted work.

### Environment reference

| Variable | Default / behavior |
| --- | --- |
| `AI_PROVIDER` | `mock`; explicit `openai` requires a key |
| `OPENAI_API_KEY` | Backend-only secret |
| `OPENAI_MODEL` | `gpt-4.1-mini` example fallback |
| `AI_TIMEOUT_MS` | 60000; allowed 100–120000; existing `.env` values are preserved |
| `AI_MAX_OUTPUT_TOKENS` | 4096; allowed 512–16000, includes reasoning tokens |
| `AI_MAX_RETRIES` | 1; allowed 0–1 |
| `AI_IMAGE_DETAIL` | `auto`; `low`, `high`, `auto` |
| `AI_REASONING_EFFORT` | Omitted unless configured; selected model must support it |
| `AI_REQUEST_BUDGET` | 100 accepted frame analyses per session, failures included |
| `AI_ANALYSIS_INTERVAL_SECONDS` | 5, default for owners without saved settings |
| `CAPTURE_INTERVAL_SECONDS` | 1, default for owners without saved settings |
| `PORT` | 3001 |
| `FRONTEND_ORIGIN` | `http://127.0.0.1:5173`; use 3001 when serving built bundles |
| `DATABASE_PATH` | `data/coach.sqlite` |
| `DEV_NO_AUTH` | Explicit `true` required for local no-auth use |
| `APP_ACCESS_TOKEN` | Optional local bearer gate; 24+ random characters, required when `DEV_NO_AUTH=false` |

Settings persist each owner's analysis/capture interval and retention. Saved settings override environment defaults and new sessions snapshot them. Capture interval must not exceed analysis interval. Default retention is 30 days.

## Persistence, privacy and security

- SQLite schema v2 uses owner-inclusive `(kind,id,owner)` keys and indexed owner lookups. Before upgrading v1, it saves an exact `.pre-v2.bak` copy. Related mutations use transactions, fsync and atomic file replacement. A PID/nonce lock rejects concurrent writers and recovers stale locks after a dead process. Stop the app before `db:init`.
- `Sessions`, `Frames`, provider adapters and `Store` separate reporting/rules/lifecycle, frame orchestration, AI and persistence. PostgreSQL can replace this repository later; PostgreSQL and a normalized multi-user deployment are not implemented. This WASM SQLite store exports the database per transaction; it is suitable for small local datasets, not high throughput or multi-process hosting.
- Raw screenshots and full recordings never enter SQLite or logs. Frame hashes/IDs, evidence text and sanitized processing metadata persist. Evidence text can itself contain sensitive information; share synthetic windows for testing. OpenAI mode transmits selected images with `store:false`, which does not guarantee zero provider retention.
- Session deletion removes events/revision histories, processing ledger and report in one transaction. Minimal audit records contain action, random resource ID and timestamp, not notes/screenshots/secrets. Settings → Delete expired sessions now deletes only expired stopped sessions without active analysis and prunes expired audit records. Cleanup is explicitly manual. Rules/settings remain until edited/deleted.
- Database backups, OS backups, downloaded videos and provider records have independent retention. Application deletion is not forensic secure erasure. Protect/remove backups separately when appropriate.
- API enforces UUID/body/query validation, real image decoding with 16-megapixel/500-KB limits, exact Origin and local Host restrictions, 180 requests/minute/IP, two global in-flight analyses and one per session. No request-supplied owner override exists. Trusted owner resolvers are injected only by the host/tests.
- Local no-auth mode is an explicit single-owner development choice. Optional `APP_ACCESS_TOKEN` gates all API endpoints except minimal health, including export/settings/deletion. The frontend asks for this separate workspace token and holds it only in memory, clearing it on reload. This token is not your OpenAI key and is not per-user authentication.
- The server stays bound to loopback. Production bundles add CSP, anti-framing, nosniff and no-referrer headers. Host/Origin/CORS and the local token do not make this production-secure. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) before any hosting.
- HTTP logs contain method/status/duration only; audit records contain metadata only. Raw provider messages and request bodies are never logged or returned.

## Troubleshooting

- **401 invalid API key:** a saved `sk-proj-` string can still be rejected. Stop capture, verify the complete active key with its issuer, save `.env`, restart and explicitly run the connection test only when authorized. The app does not print the secret.
- **No suggestions:** inspect AI status and the inline error near the controls. A successfully analyzed empty response is labelled “no findings.” Three consecutive failures or fatal configuration errors pause sampling. Inspect the report's processing history and latency.
- **Output incomplete:** increase `AI_MAX_OUTPUT_TOKENS` or configure a supported reasoning effort; the adapter handles token exhaustion/refusal/malformed output without saving invented findings.
- **Timeout:** existing `.env` may still contain the original 20000ms timeout. Configure an appropriate bounded timeout and interval for the selected model; no actual latency is promised.
- **Mock timeout:** the deterministic timeout scenario intentionally waits until the configured outer timeout aborts it. Controls remain usable, but finalization may wait for that bound.
- **Database already in use:** stop the other server/migration. Do not delete a live process's lock or run parallel servers against one file. A dead-process lock is reclaimed on next startup.
- **Wrong port/origin:** use exact `127.0.0.1` URLs. Vite stays on 5173; change the configured Origin if you intentionally use another frontend origin.
- **Screen sharing unsupported:** use desktop Chrome/Edge on localhost/HTTPS. Embedded browser policies may block it; use a normal browser. Permission remains browser-controlled.
- **Lost session:** reopening cannot recreate a media stream. Finalize the interrupted session or wait for heartbeat recovery and start a new one.

## File map and further instructions

`src/App.tsx`, `src/capture.ts`, `src/api.ts`, `src/components/`, `src/styles.css`; `server/app.ts`, `server/sessions.ts`, `server/frames.ts`, `server/providers.ts`, `server/provider-errors.ts`, `server/config.ts`, `server/db.ts`, `server/index.ts`, `server/migrate.ts`; `shared/schema.ts`; `scripts/check-ai.ts`, `scripts/smoke.mjs`, `scripts/dev.mjs`; `tests/` and deterministic JPEG fixture. `sharp` is the only new runtime dependency, used to decode/validate bounded images rather than trusting MIME headers.

See [API.md](docs/API.md), [TESTING.md](docs/TESTING.md), [DEPLOYMENT.md](docs/DEPLOYMENT.md), [PROJECT_STATUS.md](PROJECT_STATUS.md) and [IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md).
