# Testing Tradzyn

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:smoke
npm.cmd audit
```

The smoke test uses an isolated temporary SQLite file and mock AI. It starts the compiled server, tests the public entry and protected route, signs in with a seeded account, creates a journal entry, processes an idempotent fixture frame, reviews and exports a report, restarts the server, and checks persistence and logout. No paid calls or payments are required.

## Chrome and Edge native capture check

1. Seed the local demo account using [Authentication setup](AUTHENTICATION_SETUP.md). Open a top-level Chrome or Edge tab at http://127.0.0.1:5173/. Sign in on `/login`.
2. Make a separate synthetic test window or tab containing the text “DEMO DATA. Reviewing a possible setup. No real account or trades.”
3. Open **AI Companion** and expand **Capture diagnostics**. Confirm secure context and screen sharing API support.
4. Check consent and click **Start recording**. The native picker should open immediately. Cancel once to check the permission error and idle state.
5. Click again and select the synthetic window or tab. Confirm the preview, visible timer, frame counter and labeled mock observations. Inspect the diagnostics for MediaRecorder support and last analysis latency.
6. Pause and resume. Navigate to the dashboard while sharing and check that the active indicator and stop control remain visible.
7. Stop via the browser toolbar and check that the app finalizes the session. Repeat using **Stop & generate report**. Verify review/correction, notes, export and deletion.
8. Sign in with a free Google test account after configuring OAuth. Verify the journal remains accessible and the AI Companion shows the Premium lock.

Automated capture tests use controlled media tracks and a simulated permission result. Live Google, native browser permission and device behavior, and gateway sandbox results need separate verification in the target environment.
