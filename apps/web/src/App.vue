<script setup lang="ts">
import { ref } from 'vue'
import type { TrialQuestion } from '@peraquest/contracts'
import { ApiRequestError, createStudentOnboarding, createTrialAttempt, getCapabilities, getGuardianStatus } from './api/onboarding'
import { createDemoSession, fetchDemoCapabilities, fetchDemoStudentKnowledge, type DemoSessionResponse } from './api/demoFlow'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import TrialLesson from './components/TrialLesson.vue'
import TrialResult from './components/TrialResult.vue'
import KnowledgeMastery from './components/KnowledgeMastery.vue'
import StudentApp from './views/StudentApp.vue'
import GuardianApp from './views/GuardianApp.vue'

type Step = 'onboarding' | 'guardian' | 'trial' | 'result' | 'adult' | 'demo'
type DemoRole = 'student' | 'guardian'
type DemoJourneySummary = {
  completedQuestCount: number
  totalQuestCount: number
  totalXp: number
  activityCoins: number
  masteryAverage: number
  highlights: string[]
  badges: string[]
  nextStep: string
}
const step = ref<Step>('onboarding')
const score = ref(0)
const trialRedeemed = ref(false)
const trialAttemptId = ref('')
const trialQuestion = ref<TrialQuestion | null>(null)
const trialQuestionCount = ref(0)
const trialPending = ref(false)
const trialError = ref('')
type TrialStatus = 'idle' | 'loading' | 'error' | 'expired' | 'complete'
const trialStatus = ref<TrialStatus>('idle')
const onboardingPending = ref(false)
const onboardingError = ref('')
const demoPending = ref(false)
const demoSlowStart = ref(false)
const demoError = ref('')
const demoRole = ref<DemoRole>('student')
const demoSession = ref<DemoSessionResponse | null>(null)
const demoCapabilities = ref<Record<string, unknown> | null>(null)
const demoInvitationCode = ref('')
const demoKnowledgeItems = ref<Array<{ knowledgePointRef: string; masteryScore: number; state: string; dueAt: string | null }>>([])
const demoJourneySummary = ref<DemoJourneySummary | null>(null)
const guardianReportRefreshKey = ref(0)

async function refreshDemoState() {
  if (!demoSession.value) return
  const capabilities = await fetchDemoCapabilities(demoSession.value.studentToken)
  if (!capabilities.ok) throw new Error('demo capabilities failed')
  demoCapabilities.value = capabilities.body as Record<string, unknown>
}

async function refreshDemoKnowledge() {
  if (!demoSession.value) return
  const knowledge = await fetchDemoStudentKnowledge(demoSession.value.studentToken)
  if (!knowledge.ok) return
  demoKnowledgeItems.value = ((knowledge.body as { items?: typeof demoKnowledgeItems.value }).items ?? [])
}

async function startProductDemo() {
  demoPending.value = true
  demoSlowStart.value = false
  demoError.value = ''
  const slowStartTimer = window.setTimeout(() => {
    if (demoPending.value) demoSlowStart.value = true
  }, 2500)
  try {
    const session = await createDemoSession()
    if (!session.ok) throw new Error('demo session failed')
    demoSession.value = session.body
    demoInvitationCode.value = ''
    demoKnowledgeItems.value = []
    demoJourneySummary.value = null
    demoRole.value = 'student'
    await refreshDemoState()
    step.value = 'demo'
  } catch (error) {
    console.error(error)
    demoError.value = 'デモ環境を準備できませんでした。少し待ってから、もう一度開始してください。'
  } finally {
    window.clearTimeout(slowStartTimer)
    demoPending.value = false
    demoSlowStart.value = false
  }
}

function resetProductDemo() {
  demoSession.value = null
  demoCapabilities.value = null
  demoInvitationCode.value = ''
  demoKnowledgeItems.value = []
  demoJourneySummary.value = null
  guardianReportRefreshKey.value = 0
  demoRole.value = 'student'
  demoError.value = ''
  step.value = 'onboarding'
}

async function finishOnboarding(birthMonth: string) {
  onboardingPending.value = true
  onboardingError.value = ''
  try {
    const result = await createStudentOnboarding(birthMonth)
    sessionStorage.setItem('lingoquest.student.id', result.studentId)
    const [guardian, capabilities] = await Promise.all([getGuardianStatus(), getCapabilities()])
    const safelyRestricted = guardian.status === 'pending'
      && capabilities.guardianLinkStatus === 'pending'
      && !capabilities.canLearn
      && !capabilities.canUploadVoice
      && !capabilities.canPurchase

    if (result.onboardingStatus === 'pending_guardian' && safelyRestricted) step.value = 'guardian'
    else if (result.onboardingStatus === 'active' && capabilities.canLearn) step.value = 'adult'
    else throw new Error('INCONSISTENT_ACCESS_POLICY')
  } catch {
    onboardingError.value = '安全設定を確認できませんでした。接続を確認して、もう一度お試しください。'
  } finally {
    onboardingPending.value = false
  }
}

async function startTrial() {
  if (trialRedeemed.value || trialPending.value) return
  trialPending.value = true
  trialStatus.value = 'loading'
  trialError.value = ''
  try {
    const attempt = await createTrialAttempt()
    trialAttemptId.value = attempt.attemptId
    trialQuestion.value = attempt.question
    trialQuestionCount.value = attempt.questionCount
    trialStatus.value = 'idle'
    step.value = 'trial'
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409 && error.code === 'TRIAL_ALREADY_REDEEMED') {
      trialRedeemed.value = true
      trialStatus.value = 'expired'
      trialError.value = 'このアカウントのおためしクエストは利用済みか、有効期限が切れています。'
    } else {
      trialStatus.value = 'error'
      trialError.value = 'おためしクエストを開始できませんでした。接続を確認して、もう一度お試しください。'
    }
  } finally {
    trialPending.value = false
  }
}

function expireTrial() {
  trialAttemptId.value = ''
  trialQuestion.value = null
  trialQuestionCount.value = 0
  trialRedeemed.value = true
  trialStatus.value = 'expired'
  trialError.value = 'おためしクエストの有効期限が切れました。新しいおためしは開始せず、保護者の方に連携をお願いしてください。'
  step.value = 'guardian'
}

function completeTrial(value: number) {
  score.value = value
  trialRedeemed.value = true
  trialStatus.value = 'complete'
  step.value = 'result'
}

async function onDemoInvitationCreated(code: string) {
  demoInvitationCode.value = code
  demoRole.value = 'guardian'
}

async function onDemoChanged() {
  try {
    await refreshDemoState()
    await refreshDemoKnowledge()
  } catch (error) {
    console.error(error)
    demoError.value = '最新の状態を確認できませんでした。時間をおいてもう一度お試しください。'
  }
}

function onStudentKnowledgeUpdated(items: typeof demoKnowledgeItems.value) {
  demoKnowledgeItems.value = items
  guardianReportRefreshKey.value += 1
}

function onStudentJourneyUpdated(summary: DemoJourneySummary) {
  demoJourneySummary.value = summary
}
</script>

<template>
  <main class="app-shell">
    <a
      class="skip-link"
      href="#main-content"
    >本文へ移動</a>
    <header class="brand-bar">
      <a
        class="home-link"
        href="/"
        aria-label="LingoQuest JP ホーム"
      ><span aria-hidden="true">LQ</span> LingoQuest JP</a>
      <nav
        v-if="step === 'demo'"
        class="role-tabs"
        aria-label="体験する役割"
      >
        <button
          type="button"
          :class="{ active: demoRole === 'student' }"
          @click="demoRole = 'student'"
        >
          生徒として体験
        </button>
        <button
          type="button"
          :class="{ active: demoRole === 'guardian' }"
          @click="demoRole = 'guardian'"
        >
          保護者として体験
        </button>
      </nav>
      <span v-else>英検3級</span>
    </header>
    <div
      id="main-content"
      class="stage"
      tabindex="-1"
    >
      <BirthMonthForm
        v-if="step === 'onboarding'"
        :submitting="onboardingPending"
        :demo-submitting="demoPending"
        :demo-slow-start="demoSlowStart"
        :submit-error="onboardingError || demoError"
        @submit="finishOnboarding"
        @start-demo="startProductDemo"
      />
      <div
        v-else-if="step === 'demo' && demoSession"
        class="demo-product-shell"
      >
        <div class="demo-session-actions">
          <div>
            <strong>Demo Session</strong>
            <span>状態が残った場合は、最初から新しい体験を開始できます。</span>
          </div>
          <button
            type="button"
            class="secondary-action"
            @click="resetProductDemo"
          >
            最初からやり直します
          </button>
        </div>
        <StudentApp
          v-show="demoRole === 'student'"
          :session="demoSession"
          :capabilities="demoCapabilities"
          :invitation-code="demoInvitationCode"
          :knowledge-items="demoKnowledgeItems"
          @refresh="onDemoChanged"
          @invitation-created="onDemoInvitationCreated"
          @knowledge-updated="onStudentKnowledgeUpdated"
          @journey-updated="onStudentJourneyUpdated"
        />
        <GuardianApp
          v-show="demoRole === 'guardian'"
          :session="demoSession"
          :invitation-code="demoInvitationCode"
          :capabilities="demoCapabilities"
          :knowledge-items="demoKnowledgeItems"
          :student-journey-summary="demoJourneySummary"
          :report-refresh-key="guardianReportRefreshKey"
          @verified="onDemoChanged"
          @consent-changed="onDemoChanged"
          @knowledge-updated="demoKnowledgeItems = $event"
        />
        <p
          v-if="demoError"
          class="field-error"
          role="alert"
        >
          {{ demoError }}
        </p>
      </div>
      <GuardianWait
        v-else-if="step === 'guardian'"
        :trial-redeemed="trialRedeemed"
        :trial-pending="trialPending"
        :trial-error="trialError"
        :trial-status="trialStatus"
        @start-trial="startTrial"
      />
      <TrialLesson
        v-else-if="step === 'trial' && trialQuestion"
        :attempt-id="trialAttemptId"
        :initial-question="trialQuestion"
        :question-count="trialQuestionCount"
        @complete="completeTrial"
        @expired="expireTrial"
      />
      <TrialResult
        v-else-if="step === 'result'"
        :score="score"
        :total="trialQuestionCount"
      />
      <KnowledgeMastery v-else />
    </div>
    <footer><span>© LingoQuest JP</span><span>安全とプライバシーを最優先に設計しています</span></footer>
  </main>
</template>
