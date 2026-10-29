# Deploy the complete demo on Render

The app is prepared for **one hosted demo service**, serving the frontend and API together. No account has been authorized or external deployment performed yet. The demo is deliberately mock-only and token-protected; the local real-OpenAI workflow remains unchanged. A hosted live-AI/multi-user version needs additional security/tenant work and explicit cost approval.

## Why this route

The existing app runs a long-lived Express process and writes SQLite on disk. Deploying only Vite's `dist` to Vercel would leave `/api` unavailable. A complete serverless migration needs external transactional storage and redesigned processing/recovery. Render can run the current process without that rewrite. [Render web services](https://render.com/docs/web-services).

**Free demo limits:** Render free instances sleep after 15 minutes without incoming traffic and may take about a minute to wake. Local SQLite changes are lost on sleep/restart/redeploy. Persistent disks require a paid instance. Export reports during the demo; use synthetic data only. No paid plan/disk is provisioned by the supplied Blueprint. Hosting usage limits still apply. [Free service documentation](https://render.com/docs/free).

## 1. Prepare a clean source folder

```powershell
cd D:\trading
npm.cmd run demo:package
```

The command creates a new folder under `release/` with source files only and a manifest, excluding your `.env`, API key, personal SQLite files, recordings, dependencies, build output and unrelated Git history. Do not upload `D:\` or copy your personal `data/` folder. Do not initialize/push the drive-root repository. This workspace does not currently have its own Git repository; the parent drive has unrelated Git state.

## 2. Put this project in its own private GitHub repository

1. Sign into GitHub and create a **new private** repository named `tradelens-demo` (or another unused name).
2. Upload the **contents of the generated source folder**, not a ZIP and not its containing `release` folder. `package.json`, `render.yaml`, `src/`, `server/`, `shared/`, `scripts/` and `tests/` should be at repository root. Alternatively clone the new empty repository into a separate folder and copy only the generated contents before committing/pushing.
3. Verify `.env`, `data/`, recordings and credentials are absent before committing. `.env.example` contains blank/example values and is safe.

Do not reuse an unrelated existing repository. The connected GitHub account can be used if desired, but creating/connecting the hosting project may require your own account login/authorization.

## 3. Create the Render demo

1. Open [Render Dashboard](https://dashboard.render.com/) and sign in.
2. Select **New → Blueprint** and connect the dedicated private GitHub repository. Authorize access to that repository only if possible.
3. Render reads the included root `render.yaml`. Confirm the service is a **Free** web service before applying it. No OpenAI API key is needed.
4. Deploy. Build: `npm ci --include=dev && npm run build && npm prune --omit=dev`; start: `npm start`; health path: `/api/health`. Build tools are explicitly installed even when NODE_ENV is production, then removed for runtime. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; the app derives its exact HTTPS origin and permitted hostname.
5. Wait for the service to become Live, then open its assigned HTTPS `onrender.com` address. Do not guess the URL from the proposed name; Render may add a suffix.

If you use **New → Web Service** instead of Blueprint, configure:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start | `npm start` |
| Instance | Free, one instance |
| Health check | `/api/health` |
| `DEPLOYMENT_MODE` | `hosted_demo` |
| `DEV_NO_AUTH` | `false` |
| `APP_ACCESS_TOKEN` | A unique random secret of at least 24 characters |
| `AI_PROVIDER` | `mock` |
| `DEMO_EPHEMERAL_STORAGE` | `true` |
| `DATABASE_PATH` | `/tmp/tradelens-demo/coach.sqlite` |
| `AI_TIMEOUT_MS` | `10000` |
| `AI_REQUEST_BUDGET` | `20` |
| `NODE_VERSION` | `22` |

Leave `FRONTEND_ORIGIN` unset on Render so its public URL is used. Do not upload your local `.env` or define an OpenAI key in this demo. Hosted mode refuses OpenAI to prevent accidentally exposing a shared paid analysis endpoint. It also refuses insecure origins or missing/no-auth workspace credentials. Local mode still binds only to loopback.

## 4. Unlock and show it to Sir

The Blueprint generates `APP_ACCESS_TOKEN` securely in Render's environment. Retrieve that value privately in the service's Environment settings. Enter it in the website's **Workspace access token** field. This is a separate demo password, not an OpenAI API key. The value is held in browser memory and must be re-entered after reload. Share the URL and demo token privately with your intended reviewer.

All holders of the same token see the same demo workspace. This is a shared demonstration, not separate user accounts. The UI explains that frames are uploaded to the hosting server for mock processing and that free-tier records may reset. Never share account numbers, balances, credentials or real broker screens. No raw screenshots/videos are persisted by the app, but saved evidence/review notes are shared with token holders.

## 5. Verify the deployed demo

1. Open the HTTPS address in a normal desktop Chrome/Edge tab. A cross-origin embedded preview/iframe may prohibit screen sharing.
2. Before unlocking, API data should require the workspace token; `/api/health` returns minimal health only.
3. Unlock, add a categorized rule and verify the hosted/shared/mock notice.
4. Open Live coach, consent, start and select synthetic Notepad content. Verify recording/frames and SIMULATED observations. The hosted mock does not interpret your screen.
5. Pause/resume, stop, review/correct/add notes, export JSON/CSV and reopen the report. Test the provider-failure scenario; no fake findings should appear.
6. Export anything you want to retain before the service sleeps/restarts/redeploys. Refresh may require re-entering the token. Warm the service shortly before presenting to allow for a free-tier cold start.

## What is and is not verified here

Hosted configuration, strict token/HTTPS/mock requirements, exact Host/Origin handling and local startup are covered by automated tests. Existing session/capture/report tests continue to run. The Render cloud build, issued URL, platform permissions and actual HTTPS screen picker must be verified after account-authorized deployment. No cloud URL is claimed until the platform reports a successful deploy.

`Dockerfile` and `.dockerignore` are provided as an alternative container route; no local Docker engine was available, so the image itself has not been built here. The native Node production build and smoke test are verified. Do not run a container in hosted mode without the same origin/token/mock protections. A paid disk or a database migration is a separate explicitly approved step.
