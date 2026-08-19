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
