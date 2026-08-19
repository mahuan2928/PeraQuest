<script setup lang="ts">
import { ref } from 'vue'
import { createStudentOnboarding } from './api/onboarding'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import TrialLesson from './components/TrialLesson.vue'
import TrialResult from './components/TrialResult.vue'
import { trialQuestions, TRIAL_REDEEMED_KEY } from './domain/trial'

type Step = 'onboarding' | 'guardian' | 'trial' | 'result' | 'adult'
const step = ref<Step>('onboarding')
const score = ref(0)
const trialRedeemed = ref(localStorage.getItem(TRIAL_REDEEMED_KEY) === 'true')
const onboardingPending = ref(false)
const onboardingError = ref('')

async function finishOnboarding(birthMonth: string) {
  onboardingPending.value = true
  onboardingError.value = ''
  try {
    const result = await createStudentOnboarding(birthMonth)
    sessionStorage.setItem('lingoquest.student.id', result.studentId)
    step.value = result.onboardingStatus === 'pending_guardian' ? 'guardian' : 'adult'
  } catch {
    onboardingError.value = '安全設定を確認できませんでした。通信環境を確認して、もう一度お試しください。'
  } finally {
    onboardingPending.value = false
  }
}
function startTrial() {
  if (!trialRedeemed.value) step.value = 'trial'
}
function completeTrial(value: number) {
  score.value = value
  trialRedeemed.value = true
  localStorage.setItem(TRIAL_REDEEMED_KEY, 'true')
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
        @start-trial="startTrial"
      />
      <TrialLesson
        v-else-if="step === 'trial'"
        :questions="trialQuestions"
        @complete="completeTrial"
      />
      <TrialResult
        v-else-if="step === 'result'"
        :score="score"
        :total="trialQuestions.length"
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
