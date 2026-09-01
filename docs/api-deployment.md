# Dev API deployment status

PR20 wires the web client to a separately deployed Node API while keeping the Cloudflare Worker read-only and static-only.

The Dev API is deployed separately from the static web client. The current Dev service is `https://peraquest-api-dev.onrender.com`; production is not changed by this document.

## Local development

Use one API port everywhere: `3000`.

```sh
cp .env.example .env
npm run dev:api                 # http://localhost:3000
npm run dev:web                 # http://localhost:5173
```

`VITE_API_BASE_URL` is empty locally so Vite proxies `/v1` to the API. When a real Dev API is provisioned, set it to that API's exact origin for a built web client. `CORS_ORIGIN` must be one exact `http(s)` origin with no path or trailing slash.

`AUTH_PROVIDER` selects the `auth_identities.provider` namespace used to map a verified Bearer token `sub` to a local user. The selected provider, issuer, audience, and JWKS URL must describe the same identity deployment.

## Cloudflare Worker

`wrangler.jsonc` deploys only `apps/web/dist` and intentionally contains no API secrets. The Worker is read-only static hosting; it is not an API deployment. Do not point users at a made-up Dev API address. When a real Dev API exists, set `VITE_API_BASE_URL` as a build environment variable in Cloudflare Pages/Workers Builds.

## Node API placeholder

The Render Web Service should build from `main` and run the API workspace.

Required settings:

```sh
npm install
npm run build -w @peraquest/api
```

Pre-deploy command:

```sh
npm run migrate -w @peraquest/api && npm run seed:demo -w @peraquest/api
```

Start command:

```sh
npm run start -w @peraquest/api
```

For the shared Dev/demo API, use `NODE_ENV=development` so demo endpoints remain available. A production API must use `NODE_ENV=production` and provide real `AUTH_PROVIDER`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URL`; production always disables demo endpoints.

## Identity provisioning

`POST /v1/students/onboarding` supports two modes:

- When called with `Authorization: Bearer <provider-token>`, the API verifies issuer, audience, expiry, and `sub`, then atomically creates `users`, `auth_identities`, and any required guardian-link state in one transaction.
- When called without Authorization, the API preserves the local legacy onboarding path used by development tests and the current static web registration flow.

The API never accepts a client-supplied provider subject. The subject always comes from the verified Bearer token.

## Web checkout webhook

`POST /v1/payments/web-checkout/webhook` is the server-to-server entry point for web checkout entitlement projection. Set `WEB_CHECKOUT_WEBHOOK_SECRET` in the API environment before enabling the route.

The sender must compute `X-PeraQuest-Webhook-Signature` as a lowercase hex HMAC-SHA256 over the canonical JSON payload using `WEB_CHECKOUT_WEBHOOK_SECRET`. The payload must include:

- `eventId`
- `eventType`: `subscription.active`, `subscription.grace_period`, `subscription.expired`, or `subscription.revoked`
- `studentId`
- `purchaserGuardianId`
- `externalSubscriptionId`
- `entitlementCode`
- `validUntil` when the entitlement has a known expiry

The API records each `eventId` in `payment_webhook_events` and updates `subscription_entitlements` only when the purchaser is the verified guardian for the student. Duplicate events return success without issuing duplicate entitlements.
