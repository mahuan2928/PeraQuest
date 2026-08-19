# Cloudflare Workers Builds

Cloudflare deploys only the PC browser fallback. Installable iOS, Android, and desktop artifacts use the native release matrix.

## Build settings

- Root directory: repository root
- Build command: `npm run build:cloudflare`
- Deploy command: `npm run deploy:cloudflare`
- Wrangler config: `wrangler.jsonc`
- Static assets: `apps/web/dist`
- SPA fallback: `single-page-application`

The committed Wrangler configuration removes framework and monorepo output guessing.

## Diagnosis

1. Confirm Workers Builds runs from the repository root.
2. Confirm the build creates `apps/web/dist/index.html`.
3. Confirm deploy uses the pinned Wrangler version.
4. If the check still fails, open its Cloudflare Build ID and capture the first failing command; GitHub exposes only the ID, not Cloudflare's log body.
5. The API is deployed separately; this Worker serves no API secrets.
