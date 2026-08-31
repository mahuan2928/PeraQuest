# Cross-platform backend implementation plan v0.1

Scope: iOS, Android, and PC clients for Eiken Grade 3 onboarding, guardian linkage, voice consent, capabilities, payments, notifications, LINE return, and subscription entitlements.

## Decisions applied in this slice

- API contracts carry a normalized `client.platform` (`ios`, `android`, `pc`) plus optional device, app, and OS versions. Business records remain platform-neutral.
- Authentication identities are provider-based and can be linked across devices. Apple, Google, and email magic-link are contract options; access-token verification remains an Architect integration point.
- Voice upload is never sent through the general answer API. The capability response exposes `signed_upload` only after deployment flags, guardian status, and current consent all pass. The ticket endpoint repeats the server-side gate.
- Payment channels are platform-specific: App Store on iOS, Play Billing on Android, and web checkout on PC. Entitlements are normalized server-side so access follows the learner across platforms; capabilities now read active/grace-period entitlement projections from `subscription_entitlements`.
- Notifications are device registrations, not account fields: current device metadata upsert and conservative push disable are available for Bearer students, while APNs, FCM, web push token registration, and guardian LINE provider integrations remain separate work.
- Guardian invitation/verification is Bearer-only: minor students can issue short-lived invite codes, and guardians verify them with Bearer identity; only invite hashes are stored.
- Verified guardians can write voice-processing consent for linked minor students with Bearer identity; legacy guardian headers remain only for compatibility routes.
- LINE OAuth state must store an allowlisted return target. Mobile may return by app deep link with HTTPS fallback; PC uses HTTPS only.

## Next implementation order

1. Continue replacing scaffold header identity with verified access tokens and identity linking. Formal stage-attempt runtime and adult voice-consent self-writes already support Bearer actors; legacy headers remain for compatibility routes.
2. Replace the in-memory repository with PostgreSQL. The migration runner is available now via `DATABASE_URL=... npm run migrate -w @peraquest/api`; deployment must run it before API rollout.
3. Add S3-compatible signed upload tickets with MIME, size, duration, checksum, expiry, and region enforcement.
4. Add idempotent App Store, Play, and web-payment webhooks; project all receipts into `subscription_entitlements`. Read-side capability projection is already wired.
5. Add APNs/FCM/web-push token registration and LINE OAuth callback/state validation. Current-device metadata registration and push disable are already wired without accepting push tokens.
6. Add audit events and deletion jobs for consent withdrawal and voice retention.

## Architect decisions still required

- Identity provider and account-linking rules, including Sign in with Apple relay addresses.
- Voice vendor, processing region, retention period, and deletion SLA.
- Native-store versus web-checkout policy and family-plan constraints per store.
- Universal Links/App Links/custom-scheme ownership for LINE return.
- Push providers and secret management.
- PostgreSQL migration runner and production connection/pooling strategy.

## Web client alignment

All clients send `X-Client-Platform`; formal learning calls and non-minor voice-consent self-writes use verified Bearer actors. Legacy compatibility routes may still accept scaffold-only `X-Student-Id`, and a minor consent write additionally requires the matching scaffold-only `X-Guardian-Id` until guardian Bearer authorization is designed. These headers are not production authentication. Clients must consume capabilities rather than infer voice, payment, notification, or entitlement access locally.

The machine-readable API contract is `docs/api/openapi.json`.

## PR #6 one-time trial integration

- `POST /v1/trial-attempts` atomically consumes the learner's single trial entitlement and returns question 1 without its answer. A repeated start returns `409 TRIAL_ALREADY_REDEEMED`.
- `POST /v1/trial-attempts/{attemptId}/answers` accepts only the current question, returns feedback and the next answer-free question, and returns the score only on completion.
- Both responses declare `progressPersisted: false`. Only a minimal durable redemption marker is retained; raw answers and scores are never written as long-term learning progress. Attempt counters are operational state, expire after 30 minutes, and are deleted on completion.
- Production startup requires `DATABASE_URL`; without it the API refuses to start. Development/test may use the in-memory adapter.
