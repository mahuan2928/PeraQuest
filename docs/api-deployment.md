# Dev API deployment status

PR20 wires the web client to a separately deployed Node API while keeping the Cloudflare Worker read-only and static-only.

There is currently **no real Dev API address**. Any `https://api-dev.example.invalid` value below is documentation-only and must not be treated as a deployed endpoint. No API deployment is being fabricated, and Prod is not changed by PR20.

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

`apps/api/Dockerfile` is a provider-neutral placeholder. A future Dev deployment must supply `DATABASE_URL`, `CORS_ORIGIN`, `AUTH_PROVIDER`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, and `NODE_ENV=production` through its provider, expose port `3000`, and run migrations through the provider's release job before starting the container. Production configuration is not changed by PR20.

## Identity provisioning limitation

`POST /v1/students/onboarding` currently creates `users` and guardian-link state only; it does **not** insert an `auth_identities` row. Until a trusted provisioning flow atomically binds the verified provider `sub` to the new user, newly onboarded students cannot authenticate through the real Bearer path. Do not create this mapping from an unverified client-supplied subject.
