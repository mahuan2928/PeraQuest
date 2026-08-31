# API Demo Script

This demo runs the backend in-process with an in-memory repository and fake Bearer identities. It does not require PostgreSQL, object storage, a voice vendor, payment providers, or push providers.

## Run

```bash
npm run demo:api -w @peraquest/api
```

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

## Intentional Limits

- No real object upload is performed.
- No AI voice vendor is called.
- No payment webhook is simulated.
- No APNs, FCM, or web-push token is accepted or sent.
- The script uses deterministic fake Bearer subjects for demo only.
