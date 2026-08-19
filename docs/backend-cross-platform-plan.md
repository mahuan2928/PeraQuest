# Cross-platform backend implementation plan v0.1

Scope: iOS, Android, and PC clients for Eiken Grade 3 onboarding, guardian linkage, voice consent, capabilities, payments, notifications, LINE return, and subscription entitlements.

## Decisions applied in this slice

- API contracts carry a normalized `client.platform` (`ios`, `android`, `pc`) plus optional device, app, and OS versions. Business records remain platform-neutral.
- Authentication identities are provider-based and can be linked across devices. Apple, Google, and email magic-link are contract options; access-token verification remains an Architect integration point.
- Voice upload is never sent through the general answer API. The capability response exposes `signed_upload` only after deployment flags, guardian status, and current consent all pass. The ticket endpoint repeats the server-side gate.
- Payment channels are platform-specific: App Store on iOS, Play Billing on Android, and web checkout on PC. Entitlements are normalized server-side so access follows the learner across platforms.
- Notifications are device registrations, not account fields: APNs, FCM, web push, and guardian LINE can coexist.
- LINE OAuth state must store an allowlisted return target. Mobile may return by app deep link with HTTPS fallback; PC uses HTTPS only.

## Next implementation order

1. Replace the scaffold header identity with verified access tokens and identity linking.
2. Replace the in-memory repository with PostgreSQL. The migration runner is available now via `DATABASE_URL=... npm run migrate -w @peraquest/api`; deployment must run it before API rollout.
3. Implement guardian invitation/verification and guardian-authenticated consent writes.
4. Add S3-compatible signed upload tickets with MIME, size, duration, checksum, expiry, and region enforcement.
5. Add idempotent App Store, Play, and web-payment webhooks; project all receipts into `subscription_entitlements`.
6. Add APNs/FCM/web-push device registration and LINE OAuth callback/state validation.
7. Add audit events and deletion jobs for consent withdrawal and voice retention.

## Architect decisions still required

- Identity provider and account-linking rules, including Sign in with Apple relay addresses.
- Voice vendor, processing region, retention period, and deletion SLA.
- Native-store versus web-checkout policy and family-plan constraints per store.
- Universal Links/App Links/custom-scheme ownership for LINE return.
- Push providers and secret management.
- PostgreSQL migration runner and production connection/pooling strategy.

## Web client alignment

All clients send `X-Client-Platform`; authenticated calls currently use scaffold-only `X-Student-Id` until token middleware lands. A minor consent write additionally requires the matching scaffold-only `X-Guardian-Id`. These headers are not production authentication. Clients must consume capabilities rather than infer voice, payment, notification, or entitlement access locally.

The machine-readable API contract is `docs/api/openapi.json`.
