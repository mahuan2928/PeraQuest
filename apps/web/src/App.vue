<script setup lang="ts">
import { computed, onMounted, provide, ref, toRef } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import type { TrialQuestion } from '@peraquest/contracts'
import { ApiRequestError, createStudentOnboarding, createTrialAttempt, getCapabilities, getGuardianStatus } from './api/onboarding'
import { createDemoSession, fetchDemoCapabilities, fetchDemoStudentKnowledge, type DemoSessionResponse } from './api/demoFlow'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import TrialLesson from './components/TrialLesson.vue'
import TrialResult from './components/TrialResult.vue'
import KnowledgeMastery from './components/KnowledgeMastery.vue'
import StudentExperienceProvider from './providers/StudentExperienceProvider.vue'
import PresenterBar from './providers/PresenterBar.vue'
import CreditsPage from './pages/CreditsPage.vue'
import { guardianContextKey } from './providers/guardianContext'
import { routes } from './router'

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

const route = useRoute()
const router = useRouter()
const navItems = computed(() => routes.filter((item) => item.meta?.nav))
const isGuardianView = computed(() => route.path === '/guardian')
const isCreditsView = computed(() => route.path === '/credits')

provide(guardianContextKey, {
  session: toRef(() => demoSession.value),
  invitationCode: toRef(() => demoInvitationCode.value),
  capabilities: toRef(() => demoCapabilities.value),
  knowledgeItems: toRef(() => demoKnowledgeItems.value),
  studentJourneySummary: toRef(() => demoJourneySummary.value),
  reportRefreshKey: toRef(() => guardianReportRefreshKey.value),
  onVerified: () => { void onDemoChanged() },
  onConsentChanged: () => { void onDemoChanged() },
  onKnowledgeUpdated: (items) => { demoKnowledgeItems.value = items },
})

const demoSessionStorageKey = 'peraquest.demo.session'

function saveDemoSession(session: DemoSessionResponse) {
  try {
    sessionStorage.setItem(demoSessionStorageKey, JSON.stringify(session))
  } catch {
    // ストレージが使えない環境では、その回かぎりの体験として続行します。
  }
}

function clearDemoSession() {
  try {
    sessionStorage.removeItem(demoSessionStorageKey)
  } catch {
    // 破棄できなくても操作は継続します。
  }
}

function readDemoSession(): DemoSessionResponse | null {
  try {
    const raw = sessionStorage.getItem(demoSessionStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DemoSessionResponse
    if (!parsed?.studentToken || !parsed?.guardianToken || !parsed?.studentId) return null
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

// URL を直接開いた場合や再読み込みでも、同じ体験セッションを続けられるようにします。
onMounted(async () => {
  if (step.value !== 'onboarding') return
  const stored = readDemoSession()
  if (!stored) return
  demoSession.value = stored
  demoRole.value = 'student'
  try {
    await refreshDemoState()
    step.value = 'demo'
  } catch {
    clearDemoSession()
    demoSession.value = null
  }
})

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
    saveDemoSession(session.body)
    demoInvitationCode.value = ''
    demoKnowledgeItems.value = []
    demoJourneySummary.value = null
    demoRole.value = 'student'
    await refreshDemoState()
    step.value = 'demo'
    if (route.path !== '/') await router.replace('/')
  } catch (error) {
    console.error(error)
    demoError.value = '準備できませんでした。少し待ってから、もう一度お試しください。'
  } finally {
    window.clearTimeout(slowStartTimer)
    demoPending.value = false
    demoSlowStart.value = false
  }
}

function resetProductDemo() {
  clearDemoSession()
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
        aria-label="表示の切り替え"
      >
        <RouterLink
          :class="{ active: !isGuardianView }"
          to="/"
        >
          生徒
        </RouterLink>
        <RouterLink
          :class="{ active: isGuardianView }"
          to="/guardian"
        >
          保護者
        </RouterLink>
      </nav>
      <span v-else>英検3級</span>
    </header>
    <div
      id="main-content"
      class="stage"
      tabindex="-1"
    >
      <CreditsPage v-if="isCreditsView" />

      <BirthMonthForm
        v-else-if="step === 'onboarding'"
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
        <StudentExperienceProvider
          :session="demoSession"
          :capabilities="demoCapabilities"
          :invitation-code="demoInvitationCode"
          :knowledge-items="demoKnowledgeItems"
          @refresh="onDemoChanged"
          @invitation-created="onDemoInvitationCreated"
          @knowledge-updated="onStudentKnowledgeUpdated"
          @journey-updated="onStudentJourneyUpdated"
        >
          <PresenterBar @reset="resetProductDemo" />
          <nav
            v-if="!isGuardianView"
            class="app-nav"
            aria-label="学習メニュー"
          >
            <RouterLink
              v-for="item in navItems"
              :key="String(item.path)"
              :to="String(item.path)"
              class="app-nav-link"
            >
              {{ item.meta?.title }}
            </RouterLink>
          </nav>
          <header
            v-if="!isGuardianView"
            class="page-head"
          >
            <p class="eyebrow">
              生徒アプリ
            </p>
            <h1>{{ route.meta?.title ?? 'ホーム' }}</h1>
          </header>
          <RouterView />
        </StudentExperienceProvider>
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
    <footer>
      <span>© LingoQuest JP</span><RouterLink to="/credits">
        出典と権利表示
      </RouterLink>
    </footer>
  </main>
</template>
