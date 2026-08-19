<script setup lang="ts">
import { ref } from 'vue'
import type { TrialAttemptResponse } from '@peraquest/contracts'
import { ApiError, createStudentOnboarding, createTrialAttempt } from './api/onboarding'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import TrialLesson from './components/TrialLesson.vue'
import TrialResult from './components/TrialResult.vue'

type Step = 'onboarding' | 'guardian' | 'trial' | 'result' | 'adult'
const step = ref<Step>('onboarding')
const score = ref(0)
const studentId = ref('')
const trial = ref<TrialAttemptResponse | null>(null)
const trialRedeemed = ref(false)
const trialPending = ref(false)
const trialError = ref('')
const onboardingPending = ref(false)
const onboardingError = ref('')

async function finishOnboarding(birthMonth: string) {
  onboardingPending.value = true
  onboardingError.value = ''
  try {
    const result = await createStudentOnboarding(birthMonth)
    studentId.value = result.studentId
    sessionStorage.setItem('lingoquest.student.id', result.studentId)
    step.value = result.onboardingStatus === 'pending_guardian' ? 'guardian' : 'adult'
  } catch {
    onboardingError.value = '安全設定を確認できませんでした。通信環境を確認して、もう一度お試しください。'
  } finally {
    onboardingPending.value = false
  }
}

async function startTrial() {
  if (!studentId.value || trialPending.value || trialRedeemed.value) return
  trialPending.value = true
  trialError.value = ''
  try {
    trial.value = await createTrialAttempt(studentId.value)
    step.value = 'trial'
  } catch (error) {
    if (error instanceof ApiError && error.code === 'TRIAL_ALREADY_REDEEMED') {
      trialRedeemed.value = true
      trialError.value = 'このアカウントのおためしクエストは完了しています。'
    } else {
      trialError.value = 'おためしクエストを開始できませんでした。もう一度お試しください。'
    }
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
      <template v-else-if="step === 'guardian'">
        <GuardianWait
          :trial-redeemed="trialRedeemed"
          :trial-pending="trialPending"
          @start-trial="startTrial"
        />
        <p
          v-if="trialError"
          role="alert"
          class="restriction-note"
        >
          {{ trialError }}
        </p>
      </template>
      <TrialLesson
        v-else-if="step === 'trial' && trial"
        :student-id="studentId"
        :attempt-id="trial.attemptId"
        :question-count="trial.questionCount"
        :first-question="trial.question"
        @complete="completeTrial"
      />
      <TrialResult
        v-else-if="step === 'result' && trial"
        :score="score"
        :total="trial.questionCount"
      />
      <section
        v-else
        class="adult-panel"
      >
        <p class="eyebrow">
          WELCOME
        </p><h1>設定を確認しました</h1><p class="lead">
          この垂直スライスは未成年の安全な初回体験を対象としています。
        </p>
      </section>
    </div>
    <footer><span>© LingoQuest JP</span><span>安全とプライバシーを最優先に設計しています</span></footer>
  </main>
</template>
