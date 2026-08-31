# API Demo Script

This demo runs the backend in-process with an in-memory repository and fake Bearer identities. It does not require PostgreSQL, object storage, a voice vendor, payment providers, or push providers.

## Run

```bash
npm run demo:api -w @peraquest/api
```

For a lightweight front-end presentation, open the web app and choose **API Demo** in the header. By default the page visualizes the same backend checkpoints without calling PostgreSQL, object storage, voice vendors, payment providers, or push providers.

## Flow Covered

1. Minor student reads capabilities before guardian verification.
2. Minor student creates a guardian invitation.
3. Guardian verifies the invitation with Bearer identity.
4. Guardian grants voice-processing consent for the minor.
5. Minor student reads capabilities and sees `signed_upload`.
6. Minor student requests a constrained S3-compatible voice upload ticket.
7. Minor student registers current device metadata.
8. Minor student disables push for the current device.
9. Guardian withdraws voice-processing consent.
10. Minor student reads capabilities and sees voice upload disabled.
11. Demo prints the queued voice data deletion job scaffold.

## Front-End Demo View

The web demo starts in static walkthrough mode. It is useful for product reviews because it shows the ready API checkpoints, the expected state transitions, and the integrations that remain intentionally out of scope.

```bash
npm run dev -w @peraquest/web
```

To run the front end against live demo API calls, start the API with demo sessions explicitly enabled:

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
npm run dev -w @peraquest/api
```

Then start the web app in live mode:

```bash
VITE_API_DEMO_MODE=live npm run dev -w @peraquest/web
```

Live mode calls `POST /v1/demo/session` first, receives short-lived demo Bearer tokens, and then calls the same guardian, consent, voice upload ticket, and device endpoints used by the backend demo. The browser never receives signing secrets, and sensitive response fields such as upload policy/signature and invite code are redacted in the UI output.

## Intentional Limits

- No real object upload is performed.
- No AI voice vendor is called.
- No payment webhook is simulated.
- No APNs, FCM, or web-push token is accepted or sent.
- The script uses deterministic fake Bearer subjects for demo only.
- `POST /v1/demo/session` is disabled by default and forced off in production.
