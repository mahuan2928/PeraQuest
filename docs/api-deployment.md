# Dev API deployment

PR19 wires the web client to a separately deployed Node API while keeping the Cloudflare Worker static-only.

## Local development

Use one API port everywhere: `3000`.

```sh
cp .env.example .env
npm run dev:api                 # http://localhost:3000
npm run dev:web                 # http://localhost:5173
```

`VITE_API_BASE_URL` is empty locally so Vite proxies `/v1` to the API. Set it to the deployed API origin (for example `https://api-dev.example.invalid`) for a built web client. `CORS_ORIGIN` must be one exact `http(s)` origin with no path or trailing slash.

## Cloudflare placeholder

`wrangler.jsonc` deploys only `apps/web/dist` and intentionally contains no API secrets. Set `VITE_API_BASE_URL` as a build environment variable in Cloudflare Pages/Workers Builds. The Node API must be deployed separately.

## Node placeholder

`apps/api/Dockerfile` is a provider-neutral placeholder. Supply `DATABASE_URL`, `CORS_ORIGIN`, and `NODE_ENV=production` through the deployment provider, expose port `3000`, and run migrations through the provider's release job before starting the container. Production configuration is not changed by PR19.
