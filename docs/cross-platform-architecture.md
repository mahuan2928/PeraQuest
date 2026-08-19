# Cross-platform architecture v0.2

## Delivery shapes

| Target | Installable output | Runtime |
| --- | --- | --- |
| iOS | signed `.ipa`, TestFlight, App Store | Capacitor shell + shared Vue application |
| Android | signed `.aab`, Play internal testing, Play Store | Capacitor shell + shared Vue application |
| Windows | signed NSIS `.exe` installer | Electron shell + shared Vue application |
| macOS | notarized `.dmg` | Electron shell + shared Vue application |
| Linux | `.AppImage` | Electron shell + shared Vue application |
| PC browser fallback | hosted web build | shared Vue application; not the only PC delivery |

## Code sharing boundary

The Vue feature application, domain contracts, API client, validation, localization and design system are shared. Capacitor and Electron shells own lifecycle, permissions, secure storage, notifications, deep links and release signing. Platform behavior is accessed through `@peraquest/platform`; feature code must not call native SDKs directly.

- `apps/web`: shared Vue feature application.
- `apps/mobile`: committed iOS and Android Capacitor projects.
- `apps/desktop`: Electron shell and Windows/macOS/Linux packager.
- `packages/platform`: capability contract used by feature code.
- `packages/contracts`: API and domain contracts.

## Platform differences

| Capability | iOS | Android | PC desktop | Browser fallback |
| --- | --- | --- | --- | --- |
| Microphone | native permission + guardian consent gate | runtime permission + guardian consent gate | OS permission + guardian consent gate | browser permission; no assumed background access |
| Secure secrets | Keychain adapter | Keystore adapter | OS credential vault adapter | no secure-storage guarantee |
| Notifications | APNs | FCM | desktop notification/update channel | optional web notification only |
| Deep links | Universal Links | App Links | custom protocol | HTTPS routes |
| Updates | App Store | Play Store | signed auto-updater | immediate web deploy |

## Build and release

1. Merge only after lint, strict type checks, unit tests and shared production builds pass.
2. Mobile jobs synchronize the shared bundle into committed Capacitor projects, then produce Android AAB and iOS archives on native runners.
3. Desktop jobs package the same bundle separately on Windows, macOS and Linux.
4. Signing, notarization and store upload use protected CI environments; secrets never enter repository files.
5. Staged channels are internal QA → closed beta/TestFlight/internal testing → production.

The workflow template lives in `ci/cross-platform-release.yml` until a credential with workflow-management permission moves it to `.github/workflows/`.

## Test matrix

| Layer | Required coverage |
| --- | --- |
| Shared unit | contracts, FSRS/domain behavior, consent/capability decisions, report transforms |
| Web component | keyboard, screen reader semantics, responsive layouts, degraded permission states |
| iOS | current + previous major iOS; small iPhone and iPad; microphone deny/revoke/interruption; offline resume |
| Android | API 26 minimum, current and previous API; phone/tablet; permission deny/revoke; process recreation |
| Desktop | Windows 11, current macOS + previous major, Ubuntu LTS; microphone permission; installer/update/deep-link |
| Contract/E2E | student onboarding → guardian consent → lesson → interview → report → guardian checkout |
| Release | signed artifact install, launch, rollback, store sandbox receipt, audit-event reproduction |
