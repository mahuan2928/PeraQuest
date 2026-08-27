# PeraQuest

Engineering foundation for the LingoQuest JP MVP: Eiken Grade 3 daily quests, AI second-stage interview simulation, guardian reporting, and guardian-controlled subscription.

## Workspace

- `apps/web` — shared Vue 3 + Vite feature client
- `apps/mobile` — installable iOS/Android Capacitor shells
- `apps/desktop` — installable Windows/macOS/Linux Electron shell
- `apps/api` — Fastify TypeScript API
- `packages/contracts` — shared MVP contracts
- `packages/platform` — cross-platform capability contract

## Start

```bash
npm install
npm run dev:web
npm run dev:api
```

Copy `.env.example` to `.env`. Voice feature flags are off by default.

## Quality gate

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Pull request CI

The active workflow is `.github/workflows/ci.yml`. It runs only validation on Linux: it does not deploy, publish, package a release, or write to Cloudflare, Render, or production.

Every pull request performs a full lifecycle-script-enabled `npm ci` from the single root `package-lock.json`, blocks high/critical production dependency findings with `npm audit`, then runs lint, typecheck, and tests. The quality job starts an isolated PostgreSQL 16 service, waits for its health check, creates `peraquest_ci`, and exposes only that runner-local database through `TEST_DATABASE_URL`; it never connects to a developer machine or Render. PostgreSQL tests may skip locally when the variable is absent, but fail immediately instead of skipping when `CI=1`.

Builds and Trial E2E are selected from the PR diff; only documentation-only changes are exempt, while unknown code or configuration paths fail safe to all builds and Trial E2E:

| Changed scope | Build gates |
| --- | --- |
| `apps/web/**` | Web plus Desktop/Mobile consumers; Trial E2E |
| `apps/api/**` | API; Trial E2E |
| `apps/desktop/**` | Desktop source |
| `apps/mobile/**` | Mobile native-project smoke |
| `packages/contracts/**` | Web, API, Desktop, Mobile; Trial E2E |
| `packages/platform/**` | Web, Desktop, Mobile; Trial E2E |
| root package/lock/tooling or CI selector | All builds; Trial E2E |
| docs only | No build or E2E; quality checks still run |
| any other code/configuration | All builds; Trial E2E |

Desktop and Mobile run dedicated source gates, but signing, native release packaging, uploads, and deployment are deliberately outside ordinary PR CI. On Linux, Desktop compiles only Electron main/preload sources: it neither signs/packages nor runs renderer copying, so it does not verify macOS renderer-copy behavior. Mobile builds Web and TypeScript, syncs both Capacitor projects, checks iOS project/config files, and runs an Android Gradle configuration smoke test; it does not archive or publish either native app.

Reproduce the checks locally with Node.js 22:

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm test
npm run test:ci
```

To inspect the exact build matrix for any two commits:

```bash
node scripts/ci/select-builds.mjs <base-sha> <head-sha>
```
