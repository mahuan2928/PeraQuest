# Dev API deployment (separate from `peraquest-dev` Worker)

Repository inspection found no usable Dev API URL or deployment configuration. `wrangler.jsonc` intentionally deploys only `apps/web/dist`, so adding API routes to the static Worker would reproduce the 405/SPA-HTML failure.

Use the smallest independent Node service deployment:

1. Build `apps/api/Dockerfile` as a Node 22 service and expose port 3000.
2. Attach a Dev-only PostgreSQL database and run `npm run migrate -w @peraquest/api` once before rollout.
3. Set `NODE_ENV=production`, `DATABASE_URL`, and `CORS_ORIGIN=https://peraquest-dev.workers.dev` in the API service. Never reuse production credentials or database.
4. Publish the service at a stable Dev origin (for example `https://<dev-api-host>`), then configure the Cloudflare Workers Build environment variable `VITE_API_BASE_URL` to that exact origin and redeploy `peraquest-dev`.
5. Verify `OPTIONS` and JSON responses from the Worker origin before promoting any change. Production remains untouched.

The API has explicit Fastify CORS handling for the allowed origin and preflight `OPTIONS`; it does not fall back to SPA assets.
