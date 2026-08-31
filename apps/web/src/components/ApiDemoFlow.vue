<script setup lang="ts">
import { computed, ref } from 'vue'
import { runLiveApiDemo, type ApiDemoCheckpoint } from '../api/demoFlow'

interface DemoStep {
  id: string
  title: string
  endpoint: string
  detail: string
  result: string
}

const demoSteps: DemoStep[] = [
  {
    id: 'capabilities-before',
    title: 'Minor capability check',
    endpoint: 'GET /v1/me/capabilities',
    detail: '保護者確認前は学習・音声・購入を fail-closed にします。',
    result: 'voiceUploadMode: disabled',
  },
  {
    id: 'invitation',
    title: 'Guardian invitation',
    endpoint: 'POST /v1/me/guardian-link/invitations',
    detail: '未成年 learner が保護者向けの一時招待コードを発行します。',
    result: 'inviteCode + expiresAt',
  },
  {
    id: 'verification',
    title: 'Guardian verification',
    endpoint: 'PUT /v1/guardian-links/verification',
    detail: 'Bearer guardian identity で招待を検証し、link を verified にします。',
    result: 'guardianLinkStatus: verified',
  },
  {
    id: 'consent-granted',
    title: 'Voice consent granted',
    endpoint: 'PUT /v1/guardian-links/{studentId}/consents/voice-processing',
    detail: '確認済み保護者だけが minor の音声処理同意を書き込めます。',
    result: 'voiceConsentStatus: granted',
  },
  {
    id: 'signed-upload',
    title: 'Signed upload ticket',
    endpoint: 'POST /v1/me/voice-upload-ticket',
    detail: '容量・時間・MIME・checksum を制限した S3-compatible POST ticket を返します。',
    result: 'voiceUploadMode: signed_upload',
  },
  {
    id: 'device',
    title: 'Device and push status',
    endpoint: 'PUT /v1/me/devices/current',
    detail: '現在端末の metadata を登録し、push disable endpoint では token を受け取りません。',
    result: 'pushEnabled: false',
  },
  {
    id: 'withdrawal',
    title: 'Consent withdrawal',
    endpoint: 'PUT /v1/guardian-links/{studentId}/consents/voice-processing',
    detail: '同意撤回時に audit event と voice data deletion job scaffold を残します。',
    result: 'deletionJob: pending',
  },
]

const completedCount = ref(0)
const checkpoints = ref<ApiDemoCheckpoint[]>([])
const running = ref(false)
const error = ref('')
const liveMode = import.meta.env.VITE_API_DEMO_MODE === 'live'
const hasRun = computed(() => completedCount.value === demoSteps.length)
const visibleSteps = computed(() => demoSteps.slice(0, completedCount.value))
const checkpointOutput = computed(() => checkpoints.value.length > 0
  ? checkpoints.value
  : visibleSteps.value.map((step) => ({ endpoint: step.endpoint, result: step.result })))

async function runDemo() {
  if (running.value) return
  completedCount.value = 0
  checkpoints.value = []
  error.value = ''
  if (!liveMode) {
    completedCount.value = demoSteps.length
    return
  }
  running.value = true
  try {
    await runLiveApiDemo((checkpoint) => {
      checkpoints.value.push(checkpoint)
      completedCount.value = checkpoints.value.length
    })
  } catch {
    error.value = 'Live API demo could not complete. Confirm the API server has DEMO_API_ENABLED=true and demo storage settings.'
  } finally {
    running.value = false
  }
}

function resetDemo() {
  completedCount.value = 0
  checkpoints.value = []
  error.value = ''
}
</script>

<template>
  <section
    class="api-demo-panel"
    aria-labelledby="api-demo-title"
  >
    <header class="api-demo-hero">
      <div>
        <p class="eyebrow">
          BACKEND API DEMO
        </p>
        <h1 id="api-demo-title">
          保護者確認から音声アップロードまで
        </h1>
        <p class="api-demo-lead">
          実装済みのバックエンド API flow を、外部 vendor なしで説明できる lightweight demo です。
        </p>
      </div>
      <div
        class="api-demo-scorecard"
        aria-label="Demo progress"
      >
        <strong>{{ completedCount }}/{{ demoSteps.length }}</strong>
        <span>steps ready</span>
      </div>
    </header>

    <div class="api-demo-actions">
      <button
        class="primary-action api-demo-run"
        type="button"
        :disabled="running"
        data-testid="run-api-demo-flow"
        @click="runDemo"
      >
        {{ liveMode ? 'Run Live API Demo' : 'Run Demo Flow' }}
      </button>
      <button
        class="api-demo-reset"
        type="button"
        :disabled="running || completedCount === 0"
        data-testid="reset-api-demo-flow"
        @click="resetDemo"
      >
        Reset
      </button>
    </div>

    <p
      class="api-demo-status"
      role="status"
      aria-live="polite"
      data-testid="api-demo-status"
    >
      {{ running ? 'Running live API calls...' : hasRun ? 'Demo flow completed. Backend API contract is ready for presentation.' : liveMode ? 'Live mode enabled. Ready to call the demo API.' : 'Ready to replay the backend API flow.' }}
    </p>
    <p
      v-if="error"
      class="api-demo-error"
      role="alert"
      data-testid="api-demo-error"
    >
      {{ error }}
    </p>

    <ol class="api-demo-timeline">
      <li
        v-for="(step, index) in demoSteps"
        :key="step.id"
        class="api-demo-step"
        :class="{ 'api-demo-step--done': index < completedCount }"
      >
        <span class="api-demo-step__number">{{ index + 1 }}</span>
        <div class="api-demo-step__body">
          <div class="api-demo-step__heading">
            <h2>{{ step.title }}</h2>
            <code>{{ step.endpoint }}</code>
          </div>
          <p>{{ step.detail }}</p>
          <strong>{{ step.result }}</strong>
        </div>
      </li>
    </ol>

    <aside
      class="api-demo-boundary"
      aria-labelledby="api-demo-boundary-title"
    >
      <h2 id="api-demo-boundary-title">
        Demo boundary
      </h2>
      <ul>
        <li>PostgreSQL, object storage, voice vendor, payment provider, push provider は不要です。</li>
        <li>本番連携は vendor・region・retention SLA 決定後に進めます。</li>
        <li>CLI demo は <code>npm run demo:api -w @peraquest/api</code> で再現できます。</li>
      </ul>
    </aside>

    <details class="api-demo-output">
      <summary>Completed API checkpoints</summary>
      <pre data-testid="api-demo-checkpoints">{{ JSON.stringify(checkpointOutput, null, 2) }}</pre>
    </details>
  </section>
</template>

<style scoped>
.api-demo-panel { width: min(980px, 100%); color: var(--ink); }
.api-demo-hero { display: flex; align-items: end; justify-content: space-between; gap: 28px; margin-bottom: 28px; }
.api-demo-hero h1 { max-width: 760px; font-size: clamp(2.35rem, 6vw, 4.9rem); }
.api-demo-lead { max-width: 640px; margin: 18px 0 0; color: #53615c; line-height: 1.7; }
.api-demo-scorecard { display: grid; flex: 0 0 150px; gap: 5px; padding: 16px; border: 2px solid var(--ink); background: var(--lime); box-shadow: 6px 6px 0 var(--ink); transform: rotate(2deg); }
.api-demo-scorecard strong { font-size: 2.45rem; line-height: 1; letter-spacing: -.08em; }
.api-demo-scorecard span { font-size: .72rem; font-weight: 900; text-transform: uppercase; }
.api-demo-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.api-demo-run { width: auto; min-width: 210px; margin-top: 0; }
.api-demo-reset { min-height: 54px; padding: 12px 18px; border: 2px solid var(--ink); color: var(--ink); background: var(--paper); font-weight: 900; box-shadow: 4px 4px 0 var(--ink); }
.api-demo-status { margin: 0 0 24px; color: var(--green); font-size: .84rem; font-weight: 900; }
.api-demo-error { margin: -8px 0 24px; color: #a72a13; font-size: .84rem; font-weight: 900; }
.api-demo-timeline { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; counter-reset: demo-step; }
.api-demo-step { display: grid; grid-template-columns: 48px 1fr; gap: 16px; padding: 18px; border: 2px solid var(--line); background: rgb(255 253 246 / 72%); opacity: .68; }
.api-demo-step--done { border-color: var(--ink); background: var(--paper); opacity: 1; box-shadow: 5px 5px 0 var(--ink); }
.api-demo-step__number { display: grid; place-items: center; width: 44px; height: 44px; border: 2px solid var(--line); border-radius: 50%; color: #65706c; font-weight: 900; }
.api-demo-step--done .api-demo-step__number { border-color: var(--green); color: white; background: var(--green); }
.api-demo-step__heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.api-demo-step h2 { margin: 0; font-size: 1.1rem; }
.api-demo-step code, .api-demo-output code, .api-demo-output pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.api-demo-step code { padding: 4px 7px; border: 1px solid var(--line); background: #eef0e5; color: var(--green); font-size: .72rem; font-weight: 800; }
.api-demo-step p { margin: 8px 0 10px; color: #65706c; line-height: 1.55; }
.api-demo-step strong { color: var(--ink); font-size: .86rem; }
.api-demo-boundary { margin-top: 24px; padding: 20px; border: 2px solid var(--ink); background: #fff0e9; box-shadow: 5px 5px 0 var(--ink); }
.api-demo-boundary h2 { margin: 0 0 10px; font-size: 1.1rem; }
.api-demo-boundary ul { display: grid; gap: 8px; margin: 0; padding-left: 20px; color: #53615c; line-height: 1.55; }
.api-demo-boundary code { color: var(--ink); font-weight: 800; }
.api-demo-output { margin-top: 18px; }
.api-demo-output summary { min-height: 44px; font-weight: 900; cursor: pointer; }
.api-demo-output pre { overflow: auto; margin: 8px 0 0; padding: 16px; border: 1px solid var(--line); background: var(--ink); color: var(--paper); font-size: .75rem; line-height: 1.45; }
@media (max-width: 680px) {
  .api-demo-hero { align-items: start; flex-direction: column; }
  .api-demo-scorecard { align-self: end; }
  .api-demo-actions { display: grid; }
  .api-demo-run, .api-demo-reset { width: 100%; }
  .api-demo-step { grid-template-columns: 1fr; }
  .api-demo-step__heading { align-items: stretch; flex-direction: column; }
}
@media (max-width: 360px) {
  .api-demo-scorecard { align-self: stretch; grid-template-columns: auto 1fr; align-items: center; }
  .api-demo-scorecard strong { font-size: 2rem; }
}
@media (prefers-reduced-motion: reduce) {
  .api-demo-scorecard, .api-demo-step, .api-demo-reset { transform: none; transition: none; }
}
</style>
