<script setup lang="ts">
import { ref } from 'vue'
import type { TrialQuestion } from '@peraquest/contracts'
import { createStudentOnboarding, createTrialAttempt, getCapabilities, getGuardianStatus } from './api/onboarding'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import TrialLesson from './components/TrialLesson.vue'
import TrialResult from './components/TrialResult.vue'
import KnowledgeMastery from './components/KnowledgeMastery.vue'

type Step = 'onboarding' | 'guardian' | 'trial' | 'result' | 'adult'
const step = ref<Step>('onboarding')
const score = ref(0)
const trialRedeemed = ref(false)
const trialAttemptId = ref('')
const trialQuestion = ref<TrialQuestion | null>(null)
const trialQuestionCount = ref(0)
const trialPending = ref(false)
const trialError = ref('')
const onboardingPending = ref(false)
const onboardingError = ref('')

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
    onboardingError.value = '安全設定を確認できませんでした。通信環境を確認して、もう一度お試しください。'
  } finally {
    onboardingPending.value = false
  }
}

async function startTrial() {
  if (trialRedeemed.value || trialPending.value) return
  trialPending.value = true
  trialError.value = ''
  try {
    const attempt = await createTrialAttempt()
    trialAttemptId.value = attempt.attemptId
    trialQuestion.value = attempt.question
    trialQuestionCount.value = attempt.questionCount
    step.value = 'trial'
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_FAILED_409') trialRedeemed.value = true
    trialError.value = 'おためしクエストを開始できませんでした。時間をおいて、もう一度お試しください。'
  } finally {
    trialPending.value = false
  }
}

function completeTrial(value: number) {
  score.value = value
  trialRedeemed.value = true
  step.value = 'result'
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
        href="/"
        aria-label="LingoQuest JP ホーム"
      ><span aria-hidden="true">LQ</span> LingoQuest JP</a><span>英検3級</span>
    </header>
    <div
      id="main-content"
      class="stage"
      tabindex="-1"
    >
      <BirthMonthForm
        v-if="step === 'onboarding'"
        :submitting="onboardingPending"
        :submit-error="onboardingError"
        @submit="finishOnboarding"
      />
      <GuardianWait
        v-else-if="step === 'guardian'"
        :trial-redeemed="trialRedeemed"
        :trial-pending="trialPending"
        :trial-error="trialError"
        @start-trial="startTrial"
      />
      <TrialLesson
        v-else-if="step === 'trial' && trialQuestion"
        :attempt-id="trialAttemptId"
        :initial-question="trialQuestion"
        :question-count="trialQuestionCount"
        @complete="completeTrial"
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
