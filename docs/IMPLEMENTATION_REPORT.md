# Tradzyn implementation report

| Area | Result |
| --- | --- |
| Public website | Responsive landing page with feature descriptions, an illustrative dashboard, one Premium plan, Login and Sign Up. Contact and legal details have marked placeholders. |
| Identity | Google authorization code with PKCE, state, nonce and ID-token verification. The same verified subject signs into the same account. An opaque HttpOnly cookie restores the session and logout revokes it. |
| Journal | Owner-scoped create, edit, delete, history, date filtering and notes search. Expected and real P&L are manual decimal inputs stored in integer cents. |
| Free dashboard | Server-calculated totals, real minus expected, daily trend, outcomes and recent entries. The dashboard reloads saved data after journal changes. |
| Subscription | One configurable Premium plan. The server checks ACTIVE status and paid-through date. The payment interface supports checkout, management, raw signed webhooks, verified event storage and payment history. The live adapter awaits the owner's gateway selection. |
| Capture | The picker runs directly in the Start recording interaction before session API requests. Startup guards and cancellation clean up failed setup. Browser-ended sharing records its end reason. Optional video errors leave frame analysis available. Development diagnostics show secure context, media support, state, latency and error. |
| AI and reporting | Mock mode is labeled and missing OpenAI credentials fall back to mock. New sessions use visible observations and uncertainty without configured rules. Review, corrections, notes, exports and recovery remain available for Premium sessions. |

## Data and removed features

The account application removes the workspace token field, old bearer gate and Strategy & Rules routes. The existing database layout already supports owner-partitioned record kinds, so it can store account, journal and billing data without a reset. Legacy SQLite rows remain under their original owner and require an explicit, owner-approved import to associate them with a Google identity. Legacy test fixtures continue to exercise historical report behavior. The default reporting currency is INR.

## Capture failure analysis

The previous app already called the picker before contacting the backend. The shared token gate could block session setup. A lifecycle gap also allowed the track to end during setup before the app installed its finalization callback. The updated flow handles track end as soon as permission is granted, blocks duplicate starts and cleans up failed sessions. The stop control remains visible when navigating away from the companion.

The reported device-specific failure was not reproduced. Windows Computer Use could not verify the Chrome URL and stopped before the native test. The [Chrome and Edge walkthrough](TESTING.md) covers picker cancellation, consent, playback, frame processing and both stop paths.

## Validation

- `npm.cmd test` passed 71 tests across 10 files. Tests cover mocked Google sign-in, account isolation, journal validation, demo restrictions, signed billing fixtures and mocked capture and report workflows.
- `npm.cmd run build` passed TypeScript and production bundling.
- `npm.cmd run test:smoke` passed protected routes, demo login, journal persistence after restart, idempotent frame processing, report export and logout.
- The initial full audit found test-runner vulnerabilities. Upgrading to Vitest 5.1 resolved them and `npm.cmd audit` reported zero vulnerabilities.
- Live Google login, payment provider sandbox behavior, native screen capture and paid OpenAI vision remain unverified. The update is local.

Use [Authentication setup](AUTHENTICATION_SETUP.md) to enable and seed the local Premium account. Use [Subscription setup](SUBSCRIPTION_SETUP.md) for gateway requirements and [Deployment](DEPLOYMENT.md) for the hosted configuration.
