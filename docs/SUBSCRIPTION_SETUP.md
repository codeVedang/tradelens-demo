# Subscription setup

## Temporary hosted testing

To test the companion before configuring payments, set these backend environment variables on Render:

```dotenv
PREMIUM_TEST_EMAILS=your-google-email@example.com
PREMIUM_TEST_UNTIL=2026-11-19T23:59:59Z
```

Use the actual Google email used to sign in. You can add multiple tester emails separated by commas. Save and deploy, sign in through Google, and open Settings to see the test-access expiry. The backend checks the verified account and expiry on companion requests. Test access expires automatically. Clear the email list and redeploy to revoke it early. Existing subscription and payment records are preserved.

This option grants Premium after Google authentication. The Google callback must be configured before hosted sign-in can work. For testing without Google credentials, use the local demo seed described in AUTHENTICATION_SETUP.md.

Free is the default. Premium requires status ACTIVE and a future paid-through date. The server checks this for companion endpoints. Session cleanup remains available to the record owner when entitlement ends. Pending, failed, expired and cancelled states cannot create or continue recording.

Provide the gateway and merchant account, the approved plan price and currency, billing period, gateway product/price identifier, sandbox configuration and webhook secret. Set `PREMIUM_PRICE_LABEL` and `PREMIUM_BILLING_PERIOD` for display. These values do not set what a gateway charges.

The server-side `PaymentProvider` in `server/billing.ts` is the integration point. Once the owner selects a provider, wire the adapter to `paymentProvider` in `server/index.ts`. Implement:

1. `createCheckout`. Use the approved provider price, persist provider linkage to the server-issued checkout ID and return an HTTPS checkout URL.
2. `verifyEvent`. Validate the signature using the original raw request body and the provider secret. Retrieve authoritative status from the provider, verify the checkout and product association, then return the normalized event with stable event ID and a verified payment reference for ACTIVE.
3. `manageUrl` when the gateway supports account management. Authorize the gateway customer using the provided account ID.
4. Register the gateway webhook at `/api/billing/webhook` and verify pending, successful, failed, cancelled, renewal and expired paths in the gateway sandbox.

Checkout remains unavailable in the standard server until an adapter is selected and wired. The test suite supplies a signed synthetic adapter to exercise webhook processing. A browser redirect does not grant access. The server deduplicates verified event IDs and ignores stale status updates. The development demo seed does not record a payment or activate another account.
