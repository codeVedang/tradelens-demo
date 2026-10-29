# Repeatable verification

Do not use a real broker account or private account screen. Automated tests use isolated in-memory/temporary SQLite, deterministic fixtures and intercepted SDK HTTP responses. No valid API key or paid request is required. Native OS/browser permission is mocked in tests and remains a manual operator step.

## Commands and scope

```powershell
cd D:\trading
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run test:smoke
npm.cmd run ai:check
```

The last command without `--allow-paid` only prints instructions and makes no API request. Never add the paid flag to automated CI. The smoke test runs the compiled server on an available loopback port with its own temporary database/token, restarts for persistence, verifies deletion and removes only its own files. Stop other servers before running a migration against their database; tests never migrate the personal database.

Tests cover: create/start/stop/report/delete, repeated stop with in-flight work, frame decode/media/size bounds, snapshots under rule edits/deletion, structured rule validation, unknown-vs-adherence assessment, owner isolation including colliding settings IDs, workspace authorization/Host/Origin/rate limits, SQL transactions and migration backups, frame idempotency including empty and failed responses, processing latency/late flags, heartbeat counts/restart recovery, corrections/notes/audits, export/CSV formula protection, deterministic mock fixtures, timeout/malformed/upstream errors, SDK request format/incomplete output, frame queue bounds, transport retry identity, close notifications, consent/denial/unsupported browsers, capture-to-report UI flow, review/filter/settings/rule forms.

## Offline browser walkthrough

Start with a local environment override rather than modifying an existing key:

```powershell
$env:AI_PROVIDER='mock'
npm.cmd run dev
```

Open http://127.0.0.1:5173 in desktop Chrome/Edge. Keep the terminal running. If workspace authentication is configured, enter the separate APP_ACCESS_TOKEN when prompted. Never enter an OpenAI key in that field.

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Open Overview; resize browser | Persisted counts or truthful empty state, compact responsive navigation, no invented financial metrics |
| 2 | Add rule, choose category and optional limit/window, edit, disable/enable | Saved fields/version persist on refresh; invalid risk >100 or fractional trade limit rejected |
| 3 | Open Live coach without consent | Start is disabled |
| 4 | Consent, start, cancel native screen picker | Permission error; no active capture/session created |
| 5 | Start again; select a safe demo window | Preview, recording indicator, wall-clock timer and screen sharing status |
| 6 | Wait for a few analysis intervals | Captured count increases; analyzed count and MOCK/SIMULATED findings update; last measured latency shown |
| 7 | Pause for 10 seconds, then resume | Sampling stops after pending work settles; screen remains shared; elapsed wall-clock includes pause |
| 8 | Edit a rule while recording | Current rule version changes; active session still uses its start snapshot |
| 9 | Stop & generate report | Tracks end; report separates statuses and includes coverage/processing history; late results labelled |
| 10 | Confirm/dismiss/correct a finding and add observation notes | Original text remains, corrected text/notes persist, revision history is inspectable |
| 11 | Add session notes, save, refresh/reopen | Review groups, notes, snapshots and history remain |
| 12 | Export JSON and CSV | JSON contains full report; CSV contains observation rows and safe quoted cells; neither includes image data/key |
| 13 | Filter sessions by text/status/date and findings by status | Only matching rows/findings appear, reversed date range reports error, Clear filters restores rows |
| 14 | New session; stop via browser's Stop sharing | App detects ended source and finalizes |
| 15 | New session; reload/close page | Sharing stops; best-effort stop or heartbeat recovery finalizes; no claim that old stream resumed |
| 16 | Open an interrupted or report-failed session | Retry finalization/report rebuild works without another AI call or duplicate events |
| 17 | Restart backend | Rules/settings/finished reports/reviews remain; interrupted metadata recovers with explicit reason |
| 18 | Delete a disposable stopped session | Associated report/events/history/frame ledger disappear together |

Synthetic Notepad content (enlarge to 20–24pt):

```text
DEMO TRADING WORKSPACE — SYNTHETIC DATA
[x] Review written strategy
[ ] Review configured risk
[ ] Verify stop-loss placement
Configured risk: NOT SHOWN
Executed orders: NOT VERIFIED
Account balance and trade outcomes: NOT SHOWN
No real trades or money are involved.
```

Mock mode deliberately does not interpret that text. Its output is a predictable fixture. In real mode, compare actual observations against visible text rather than assuming a successful HTTP request proves accuracy.

### Mock scenarios and failure handling

Run separate sessions for Normal observation, Possible rule deviation (enable at least one rule), Insufficient evidence, Provider failure and Analysis timeout. Deviation is explicitly simulated and references the session snapshot. Insufficient evidence must not become a proven violation. Error/timeout must save processing failures, not invented events. Three consecutive failures pause analysis; known fatal real-provider errors pause immediately. Resume is explicit. Timeout fixtures can take the configured timeout (up to 120 seconds) before finalization finishes; this is intentional and bounded.

### Video and retention

Enable opt-in local video before a short session, stop and download; verify the file plays. Repeat with it disabled: no new video should be offered. A previous session's video must not appear attached to a different report. Browser memory video is lost on reload, never uploaded; 100 MB cap discards video with an explicit message. Optional MediaRecorder support needs manual browser verification.

Save both intervals and retention, refresh Settings and create a new session. The active session retains its original interval and rule snapshot. Expiry cleanup is manual; recent/recording/in-flight sessions must remain. Tests use backdated fixtures to verify expired deletion. Audit metadata expires under the same manual retention process; independent backups/downloads are unaffected.

## Real API readiness procedure — only when authorized

No live API request was made for this upgrade. Earlier credentials were rejected. A new valid API key is not assumed merely because `.env` contains one. Keep the actual secret private.

1. Stop recording and the backend. Configure `AI_PROVIDER=openai`, `OPENAI_API_KEY` and the selected `OPENAI_MODEL` securely in root `.env`. Use a vision model supporting Responses and JSON-schema structured output. Keep `DEV_NO_AUTH`/local token configuration explicit.
2. Clear a temporary mock environment override (`Remove-Item Env:AI_PROVIDER` in PowerShell if you set it). Restart `npm.cmd run dev`; confirm Settings shows real mode and configured model, with connection still unverified.
3. When ready to authorize one potentially paid request, run `npm.cmd run ai:check -- --allow-paid`. It uploads a generated synthetic image with SDK retries disabled. Verify `{ok:true,structuredResponseValidated:true}` plus actual latency. 401/403/404/429/timeout are failures, never silently treated as mock success.
4. Optionally run `npm.cmd run ai:check -- --allow-paid --image D:\path\to\demo.jpg`. That explicitly uploads the named image. Use non-sensitive input; never upload `.env` or credential screenshots. Verify structured parsing and compare manually in the actual capture/report workflow; the CLI intentionally prints counts/metadata only.
5. In Settings set a conservative interval such as 15 seconds. Set a bounded request budget in backend environment if desired; it is an attempt cap, not a currency cap.
6. Start native capture of a synthetic demo window. Verify successful frame count, actual measured latency and findings without mock labels. A successful empty response is valid and says no findings. Use both visible checklist items and missing information in test inputs.
7. Confirm the model describes only supported visible evidence and marks unknown broker executions, risk, stops and outcomes. Large/clear text helps; compression/detail can limit accuracy. A stronger model does not establish broker truth.
8. Stop and inspect persisted report, evidence timestamps, rule versions, late-result labels, failed analyses and notes. Reopen after restart and export.
9. Use automated mocked 401/quota/rate-limit/timeout tests to validate failure paths without spending more. Any additional manual invalid-key/rate-limit tests must use separate temporary configuration and restore it afterward; never deliberately exhaust paid quota.
10. Record actual outcomes: date/model, successful/failed frames, measured latency, inaccurate/unsupported findings, errors and unresolved issues. Only then mark live connectivity/visual accuracy verified for the tested scenario. An SDK mock test is not live certification.

## Known limits for acceptance

Screen permission is controlled by the user/browser. Beacon delivery is not guaranteed; heartbeat recovery handles missed closes but OS sleep/background throttling can affect timing. Session video remains in memory, not durable server storage. Evidence images cannot be reopened. Old sessions have no recoverable rule snapshot/frame ledger beyond what was originally saved. A valid key is required for live capability/accuracy/latency checks; this application does not validate actual broker execution or profitability.
