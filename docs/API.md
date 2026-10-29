# Local API contract

Base `/api`; JSON requests/responses. All endpoints except health require the configured local bearer token when `APP_ACCESS_TOKEN` is enabled. Send `Authorization: Bearer <workspace-token>`; never send the OpenAI key to these endpoints. Default development identity is fixed server-side; no header can choose an owner. Host and exact Origin are checked. Unauthorized resource owners receive 404, malformed UUIDs receive 400.

| Method | Endpoint | Input / result |
| --- | --- | --- |
| GET | `/health` | `{ok:true}`, no private configuration |
| GET | `/config/status` | Provider/model, key-configured flag, `connectionStatus:unverified`, auth mode, timeout/budget, settings. No key or validation claim. |
| PUT | `/settings` | `intervalSeconds` 5–120, `captureIntervalSeconds` 1–30 (defaults to 1 for old clients), `retentionDays` 1–365. Capture interval ≤ analysis interval. |
| POST | `/retention/cleanup` | `{}` → `{deleted}`; stopped expired sessions only; prunes expired metadata audits. |
| POST | `/sessions` | `{title?:string}` → 201 session |
| GET | `/sessions` | Array, newest first; optional `q`, `status=created\|recording\|stopped`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD`. API date bounds are UTC dates; UI date filters use browser-local dates. |
| GET | `/sessions/:id` | Metadata, timestamps, mode, attempts/captured/analyzed/failed counts, rule snapshot/settings/end reason |
| POST | `/sessions/:id/start` | `{}`; created→recording, snapshot enabled rules |
| POST | `/sessions/:id/heartbeat` | `{capturedCount:integer}`; monotonic client-reported capture count and last-seen time |
| POST | `/sessions/:id/stop` | `{reason?:user\|capture_ended\|page_closed\|unmount,capturedCount?:integer}`; idempotent, awaits pending analysis, returns report |
| PATCH | `/sessions/:id` | `{notes:string}` ≤10000 chars |
| DELETE | `/sessions/:id` | Cascades events/history/frame metadata/report; 204. Rejects recording/in-flight work. |
| POST | `/sessions/:id/frames` | See frame contract below |
| GET | `/sessions/:id/events` | Timestamp-ordered findings/review history, legacy-safe defaults |
| GET | `/sessions/:id/processing` | Frame ledger without image hashes or raw screenshots |
| POST | `/events/:id/feedback` | `{sessionId:UUID,status:confirmed\|dismissed\|needs_confirmation\|insufficient_evidence,correction?:string,notes?:string}`. Optional fields preserve existing values when omitted. |
| GET | `/sessions/:id/report` | Stopped/finalized only; rebuilds and persists from existing records. Retry does not invoke AI or duplicate events. |
| GET | `/sessions/:id/export?format=json\|csv` | Attachment. JSON full report; CSV observations only with spreadsheet formula neutralization. |
| GET | `/rules` | Categorized/versioned rules, safe defaults for legacy records |
| POST | `/rules` | Rule input below → 201 |
| PUT | `/rules/:id` | Rule input, increments version; does not alter session snapshots |
| DELETE | `/rules/:id` | 204; historical snapshots remain |

## Frames and retry semantics

```json
{"frameId":"UUID","timestampSeconds":5,"image":"data:image/jpeg;base64,...","scenario":"normal","capturedCount":10}
```

JPEG/WebP only; total JSON limit 750 KB, data URL ≤720000 characters, decoded image ≤512000 bytes and 16 million pixels. Sharp actually decodes the image; MIME signatures alone are insufficient. Timestamps 0–86400 seconds; capturedCount 0–1000000. Raw image content is transient. No full-recording upload route exists.

Mock scenarios: `normal`, `deviation`, `insufficient`, `timeout`, `error`. Real providers ignore scenario selection. Timeout fixture waits for the server's abort signal. All simulated findings carry `simulated:true` and explicit SIMULATED wording.

Frame IDs are owner-scoped. A SHA-256 input fingerprint ensures the same ID cannot represent different input/session/timestamp/scenario. Terminal successful/failed results are replayed without new AI work, including successes with zero observations. A duplicate for a processing frame awaits its current task. Different frames during an active task are rejected. Legacy event-only records retain event-based deduplication. Interrupted frame records become failed on restart.

Response: `{observations:[],processing:{...},deduplicated?:true}`. Processing contains state, start/completion time, latency, provider/model, error and `completedAfterStop`. Some legacy replay responses have no processing metadata. A failed replay returns the cached sanitized error. To analyze a fresh frame use a fresh UUID after the configured interval; do not replay a failed ID expecting another paid attempt. Browser transport retries repeat the same payload at most once. SDK provider retries are separately bounded.

## Observation/review/report semantics

AI schema: category, visible description, evidence, timestamp, optional rule reference, status, `confidence:null`, qualitative uncertainty, kind, assessment, limitations. Assessments distinguish `followed`, `potential_deviation`, `not_assessable`, `awaiting_confirmation`. Unknown/missing evidence is normalized to not_assessable/insufficient_evidence. Unknown rule IDs are cleared; timestamps are anchored to submitted frame time. Model confidence is not calibrated.

Stored observations also include session/frame IDs, mock/provider/model labels, completion timestamp/latency, late-result flag, notes, optional correction and an audit history retaining prior/current review fields. A user confirmation is user feedback, not independent proof. Correction does not replace original model text in storage. Report groups reflect review status; potential deviations require applicable snapshot rule IDs and an explicit potential_deviation assessment rather than any rule reference. Repeated text counts describe observations within the session, never actual repeated trades.

Reports include start/end/recovery reason, duration, browser capture count, server submissions/analyzed/failed/pending counts, review groups, rule snapshots/findings, processing failures/latency, recurring text and session notes. Legacy sessions are labelled when snapshots or frame ledgers cannot be reconstructed. Report-only late results remain distinguishable from live completions. Exports contain evidence text and should be treated as private.

## Limits and errors

180 HTTP requests/minute/IP by default; one provider task/session, two globally; minimum analysis interval and per-session budget. Budget includes accepted provider attempts and failures; an attempt can contain one SDK retry, so it is not a dollar budget.

Errors: `{error,code?,fatal?}`. 400 invalid input/undecodable image, 401 workspace token required, 403 Host/Origin denied, 404 inaccessible/missing, 409 lifecycle/ID conflict/report still pending, 413 size, 429 HTTP/concurrency/interval/budget, 502 sanitized AI error, 504 timeout. Recognized fatal AI errors (`AI_AUTH`, `AI_QUOTA`, `AI_MODEL_ACCESS`) cause client sampling to pause. OpenAI 401 is surfaced as sanitized AI failure, not confused with workspace authentication. Unknown provider text is never returned. Metadata audits are persisted, with no public administrative or paid-diagnostic endpoint.
