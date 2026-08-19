# MVP foundation

This repository starts as a TypeScript monorepo:

- `apps/web`: Vue 3 student/guardian client using Composition API and strict TypeScript.
- `apps/api`: Fastify modular-monolith API.
- `packages/contracts`: shared API contracts; the MVP permits only Eiken Grade 3.

## Compliance defaults

Voice features are disabled unless both `VOICE_FEATURE_PUBLIC_ENABLED` and `AI_VENDOR_APPROVED` are true. The required consent version is supplied independently through `CONSENT_VERSION_REQUIRED`. These flags are deployment safeguards, not a replacement for request-level guardian and consent authorization.

## CI gate

Every pull request must pass lint, strict type checks, unit tests, and production builds before merge.
