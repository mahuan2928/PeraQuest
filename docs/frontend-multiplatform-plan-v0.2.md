# Frontend implementation plan v0.2 — iOS, Android, and PC

Status: implementation-ready plan, based on Architect PR #2 (`feat/mvp-foundation-ci`).

## Architecture decision

Keep the Architect foundation unchanged:

- TypeScript monorepo
- Vue 3 + Vite in `apps/web`
- Fastify API in `apps/api`
- shared request/response types in `packages/contracts`
- npm workspaces, Node.js 22, strict TypeScript

Add mobile delivery as a thin native shell around the same Vue application:

- `apps/web`: shared Vue application and PC Web entry
- `apps/mobile`: Capacitor configuration, iOS project, Android project, native permission adapters, deep-link/bootstrap glue
- `packages/contracts`: platform-neutral API contracts only
- future `packages/ui`: shared design tokens and reusable view components only when extraction is justified by actual reuse

Capacitor is the preferred mobile shell because it preserves the Vue/Vite implementation selected in PR #2. A separate React Native, Flutter, or native UI codebase is out of scope for MVP because it would duplicate the onboarding, guardian gate, trial lesson, accessibility, analytics, and API integration logic.

## Shared-code boundary

Shared in `apps/web/src`:

- routing and route guards
- onboarding, guardian-wait, and trial-lesson screens
- domain state and API clients
- validation and error mapping
- design tokens and accessible UI components
- responsive layouts
- analytics event definitions
- unit/component tests

Platform adapters behind typed interfaces:

```ts
interface PlatformBridge {
  platform: 'web' | 'ios' | 'android'
  openExternal(url: string): Promise<void>
  getMicrophonePermission(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'>
  requestMicrophonePermission(): Promise<'granted' | 'denied' | 'unavailable'>
  getNotificationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'>
  openAppSettings(): Promise<void>
}
```

Only the bridge implementations, native configuration, icons/splash screens, signing, and store metadata belong in `apps/mobile`. Business rules must not be copied into Swift/Kotlin.

## First vertical slice

Flow: minor first entry → guardian-binding wait → one trial lesson.

1. First entry
   - Eiken Grade 3 is fixed.
   - Collect birth month/year only.
   - Do not collect real name, school, or region.
   - Determine the minor gate from a server-owned policy response; do not hard-code a legal age in the client.
2. Guardian-binding wait
   - Default-deny when capability lookup fails.
   - Block long-term progress, voice upload, LINE report enrollment, and purchase.
   - Permit product information and exactly one accountless/non-persistent trial lesson.
3. Trial lesson
   - Fetch a server-authorized trial session.
   - Render progress, answer submission, accessible feedback, and a result.
   - Preserve the current answer on retryable failures.
   - Do not write durable learner progress.
   - Server enforces trial redemption; local storage may improve UX but is not authoritative.

## State and API contracts

Frontend state domains:

- `session`: anonymous/account session and hydration status
- `onboarding`: birth month/year draft, validation, submission
- `capabilities`: `canLearn`, `canUploadVoice`, `canPurchase`, guardian/consent requirements
- `trialLesson`: session id, questions, current index, answer draft, feedback, completion
- `platform`: runtime platform and permission snapshots

Required backend contracts (owner: Tom):

- initialize learner / evaluate minor policy
- read guardian-binding and capability state
- create or resume the one-time trial session
- fetch trial questions
- submit an answer and return feedback
- complete/redeem the trial without durable learning progress

The client must consume types from `packages/contracts`; no duplicate handwritten DTOs.

## PC Web and responsive behavior

PC delivery remains the Vite production build from `apps/web`.

Breakpoints are content-driven rather than device-name driven:

- narrow: single-column, bottom action area, safe-area padding
- medium: constrained lesson canvas with persistent progress
- wide PC: centered reading width, optional secondary context rail; never stretch questions to viewport width

Requirements:

- keyboard-complete onboarding and lesson flow
- visible focus states
- feedback announced through an ARIA live region
- no status communicated by color alone
- minimum touch targets applied on touch-capable PCs and mobile
- viewport and virtual-keyboard behavior tested on iOS Safari/WebView and Android WebView
- LINE in-app browser covered for guardian links when that flow is introduced

## Permission adaptation

The first vertical slice requests no microphone or notification permission.

Future voice work must:

- pass guardian binding and independent voice-consent gates before requesting OS permission
- default voice off unless both deployment safeguards from PR #2 are enabled
- map Web Permissions API and Capacitor native results to the shared permission enum
- provide denied/permanently-denied recovery with an explicit “open settings” action on mobile
- provide the fixed-question typing fallback when microphone access is unavailable
- never treat an OS grant as legal consent

Deep links for guardian return flows must use universal links/app links with an HTTPS web fallback. Tokens must not be persisted in URLs or analytics payloads.

## Build products

| Target | Build command / pipeline | Artifact |
|---|---|---|
| Shared/PC Web | Vite production build | `apps/web/dist/` static bundle |
| iOS simulator | Capacitor sync + Xcode simulator build | `.app` simulator bundle |
| iOS distribution | Xcode archive with managed signing | signed `.ipa` / TestFlight build |
| Android QA | Capacitor sync + Gradle assemble | debug `.apk` |
| Android distribution | Gradle bundle with managed signing | signed `.aab` |

Signing certificates, provisioning profiles, keystores, API keys, and store credentials must live only in protected CI secrets. They must never be committed, printed in logs, or embedded in Web assets.

CI should publish immutable artifacts keyed by commit SHA and retain source maps separately with restricted access. Production Web deployment and store submission remain explicit promotion steps, not automatic consequences of every PR.

## Quality gates and end-to-end matrix

Every PR:

- lint
- strict typecheck
- unit tests
- component tests
- production Web build
- Playwright Chromium flow for PC Web

Vertical-slice E2E cases:

- minor onboarding reaches guardian wait
- restricted routes cannot bypass the guardian gate
- capability failure defaults to restricted access
- exactly one trial can be redeemed
- trial completion creates no durable learning progress
- answer draft survives a retryable submission failure
- keyboard-only and basic automated accessibility checks pass

Platform lanes after shell creation:

| Lane | Tool | Coverage |
|---|---|---|
| PC Web | Playwright | Chromium required; Firefox/WebKit smoke |
| iOS | Xcode simulator + WebdriverIO/Appium | latest supported iOS plus one previous major |
| Android | Android emulator + WebdriverIO/Appium | current target API plus minimum supported API |
| Native build smoke | Xcode/Gradle | install, launch, deep-link bootstrap, offline/error startup |

Use stable `data-testid` values only at cross-platform automation boundaries. Prefer role/name selectors for user-visible Web behavior.

## Implementation order and conflict control

1. Merge or approve the Architect foundation in PR #2.
2. Create a feature branch from the merged foundation commit, not from an independently generated scaffold.
3. Add the vertical slice inside existing `apps/web` and `packages/contracts` conventions.
4. Add `apps/mobile` only after the Web slice and platform bridge contract are stable.
5. Activate CI from the reviewed template when a workflow-scoped credential is available.
6. Add native build lanes after signing ownership and bundle identifiers are confirmed.

Until PR #2 is merged, dependent planning changes should target `feat/mvp-foundation-ci`. Do not edit PR #2 files or generate a competing root workspace, Vite app, API app, lockfile, or CI scaffold.

## Dependencies and blockers

- UIEmily: responsive layouts, mobile safe-area behavior, focus/error states, and touch-target specification
- Tom: minor-policy response, guardian/capability contracts, authoritative one-trial enforcement, non-persistent completion semantics
- AI-MoMo: no blocker for this vertical slice; later owns voice/AI result contracts
- Architect: confirm Capacitor shell, application identifiers, minimum iOS/Android versions, hosting target, and CI signing ownership
- Repository administration: activate `.github/workflows` from the reviewed template; current credential cannot modify workflow files
- Distribution: Apple Developer and Google Play accounts, certificates/profiles/keystore, privacy declarations, and store metadata
