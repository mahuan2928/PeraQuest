# Product Demo

The web demo is a product-facing experience for a short-lived student and guardian demo session. It requires the API to run with `DEMO_API_ENABLED=true` and PostgreSQL, because guardian verification, voice consent, level check attempts, answers, and student knowledge projections are written to the database.

## One Command

```bash
npm run demo:full
```

The command reuses `DATABASE_URL` or `TEST_DATABASE_URL` when present. If neither is set, it starts a local Docker PostgreSQL container, runs migrations, seeds the published demo stage exam, then starts the API and web app in live mode.

## Seed Data

```bash
npm run migrate -w @peraquest/api
npm run seed:demo -w @peraquest/api
```

`seed:demo` inserts one published `stage_exams` record, one published `stage_exam_versions` record, and six EIKEN Grade 3 questions with options and answer keys. It is idempotent and can be executed repeatedly.

The seeded stage exam id is:

```text
11111111-1111-4111-8111-111111111111
```

## Backend CLI Smoke Test

```bash
npm run demo:api -w @peraquest/api
```

This script exercises the guardian and voice consent path in-process. The full browser experience should use `npm run demo:full`.

## Flow Covered

1. A demo student and guardian session is created.
2. The student starts from the product home page and creates a guardian invitation.
3. The guardian enters the invitation code and completes verification.
4. The student view refreshes capabilities and unlocks the level check.
5. The student starts a seeded stage exam attempt.
6. The student submits answers and receives a persisted result.
7. Student knowledge projections are refreshed from `student_knowledge`.
8. The guardian view shows the child's learning status using the same mastery-card language as the student product UI.
9. The guardian grants or withdraws voice-processing consent.
10. The student view refreshes capabilities and voice practice availability changes.

## Manual Live Run

```bash
DEMO_API_ENABLED=true \
DEMO_SESSION_SECRET=local-demo-session-secret \
CONSENT_VERSION_REQUIRED=v1 \
VOICE_FEATURE_PUBLIC_ENABLED=true \
AI_VENDOR_APPROVED=true \
VOICE_UPLOAD_BUCKET=peraquest-demo-voice \
VOICE_UPLOAD_REGION=ap-northeast-1 \
VOICE_UPLOAD_ENDPOINT=https://storage.demo.test \
VOICE_UPLOAD_ACCESS_KEY_ID=DEMO_ACCESS_KEY \
VOICE_UPLOAD_SECRET_ACCESS_KEY=demo-secret-only-used-for-local-signing \
npm run migrate -w @peraquest/api && \
npm run seed:demo -w @peraquest/api && \
npm run dev -w @peraquest/api
```

Then start the web app:

```bash
VITE_API_BASE_URL=http://localhost:3000 \
VITE_DEMO_STAGE_EXAM_ID=11111111-1111-4111-8111-111111111111 \
npm run dev -w @peraquest/web
```

The browser receives a short-lived demo session from the API. The product UI must not display bearer credentials, expiry timestamps, raw response bodies, endpoints, or status codes. Diagnostic details belong in DevTools console only.

## Intentional Limits

- No real object upload is performed.
- No AI voice vendor is called.
- Payment, game rewards, and guardian reports are not implemented yet; the product UI should show a quiet upcoming state instead of simulated orders.
- No APNs, FCM, or web-push token is accepted or sent.
- The script uses deterministic demo identities only for local demo sessions.
- Demo endpoints are disabled by default and forced off in production.
