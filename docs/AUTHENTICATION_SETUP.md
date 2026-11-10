# Authentication setup

Create a Google Cloud OAuth **Web application** client, set up the consent screen and add test users if the Google project is in testing. Register this local authorized redirect URI exactly:

```text
http://127.0.0.1:5173/api/auth/google/callback
```

For a hosted environment, register the exact HTTPS origin plus `/api/auth/google/callback`. Set `FRONTEND_ORIGIN` and these backend variables:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=
```

The callback override is optional and must match the derived URL. OAuth requires state, nonce, PKCE and a verified Google ID token. Users are keyed by Google subject. App sessions are random opaque cookies with their hashes and expiry stored in SQLite. HTTPS uses a Secure host-prefixed cookie. The cookie is HttpOnly, SameSite=Lax, expires after seven days and is revoked on logout. A separate signing secret is unnecessary for opaque database-backed sessions. Use the same origin for the browser and API.

## Local Premium demo

Stop the application first so the SQLite writer lock is released. Add `ENABLE_DEMO_LOGIN=true` and `AI_PROVIDER=mock` to your local `.env`, keeping your other settings. Then run:

```powershell
npm.cmd run demo:seed
npm.cmd run dev
```

The seed prints the generated password once in your terminal. Go to `/login` and use **Sign in to local demo** with `demo@tradzyn.local` and that password. Seeding creates or renews a 30-day demo Premium entitlement, inserts a labeled fictional example and rotates the prior password and demo sessions. Store the password privately. Seeding and demo authentication require explicit opt-in, a loopback origin and local nonproduction mode. Demo sessions are rejected if demo mode is disabled.

Existing fixed-owner prototype records are retained under their original owner. They are not associated with a new Google account automatically. Any import requires the owner to identify the intended destination account and review the data first.

## Hosted demo accounts

The HTTPS hosted demo supports separate email and password accounts with temporary Premium access. In PowerShell, generate three accounts and an expiry seven days from now:

```powershell
@'
const { randomBytes } = require("node:crypto");
const accounts = [1, 2, 3].map((number) => ({
  email: "demo" + number + "@tradzyn.local",
  password: randomBytes(24).toString("base64url"),
}));
console.log(JSON.stringify(accounts));
console.log(new Date(Date.now() + 7 * 86400_000).toISOString());
'@ | node
```

On Render, put the first output line in `HOSTED_DEMO_ACCOUNTS` and the second in `HOSTED_DEMO_UNTIL`. Save and deploy. Share one email and its password privately with each tester, then direct them to `/login` and **Sign in to demo**.

The accounts are enabled only for HTTPS with `DEPLOYMENT_MODE=hosted_demo` and mock analysis. Each configured email gets a separate workspace. Removing an email or rotating its password rejects existing sessions for that credential on the new deployment. The UTC expiry ends sign-in and access for all configured demo accounts. Remove the credential variable and redeploy when testing is over.
