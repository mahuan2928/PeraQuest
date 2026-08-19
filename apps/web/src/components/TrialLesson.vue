<script setup lang="ts">
import type { TrialQuestion } from '@peraquest/contracts'
import { computed, nextTick, ref } from 'vue'
import { submitTrialAnswer } from '../api/onboarding'

const props = defineProps<{
  attemptId: string
  initialQuestion: TrialQuestion
  questionCount: number
}>()
const emit = defineEmits<{ complete: [score: number] }>()
const questionNumber = ref(1)
const current = ref<TrialQuestion>(props.initialQuestion)
const selected = ref('')
const submitted = ref(false)
const submitting = ref(false)
const answerCorrect = ref(false)
const correctAnswer = ref('')
const explanation = ref('')
const completedScore = ref<number | null>(null)
const nextQuestion = ref<TrialQuestion | null>(null)
const serviceError = ref('')
const feedback = ref<HTMLElement | null>(null)
const progress = computed(() => (questionNumber.value / props.questionCount) * 100)

async function submitAnswer() {
  if (!selected.value || submitted.value || submitting.value) return
  submitting.value = true
  serviceError.value = ''
  try {
    const result = await submitTrialAnswer(props.attemptId, {
      questionId: current.value.id,
      answer: selected.value,
    })
    answerCorrect.value = result.correct
    correctAnswer.value = result.correctAnswer
    explanation.value = result.explanation
    completedScore.value = result.completed ? result.score : null
    nextQuestion.value = result.nextQuestion
    submitted.value = true
    await nextTick()
    feedback.value?.focus()
  } catch {
    serviceError.value = '答えを送信できませんでした。回答はそのままです。もう一度お試しください。'
  } finally {
    submitting.value = false
  }
}

function next() {
  if (completedScore.value !== null) {
    emit('complete', completedScore.value)
    return
  }
  if (!nextQuestion.value) {
    serviceError.value = '次の問題を確認できませんでした。もう一度お試しください。'
    return
  }
  current.value = nextQuestion.value
  questionNumber.value += 1
  selected.value = ''
  submitted.value = false
  answerCorrect.value = false
  correctAnswer.value = ''
  explanation.value = ''
  nextQuestion.value = null
  serviceError.value = ''
}
</script>

<template>
  <section
    class="lesson-panel"
    aria-labelledby="question-title"
  >
    <header class="lesson-header">
      <div>
        <p class="eyebrow">
          TRIAL QUEST
        </p><strong>英検3級 · おためし</strong>
      </div>
      <p aria-live="polite">
        {{ questionNumber }} / {{ questionCount }}
      </p>
    </header>
    <div
      class="progress-track"
      role="progressbar"
      :aria-valuenow="questionNumber"
      aria-valuemin="1"
      :aria-valuemax="questionCount"
      :aria-label="`問題 ${questionNumber} / ${questionCount}`"
    >
      <span :style="{ width: `${progress}%` }" />
    </div>

    <article class="question-card">
      <span class="ability-tag">{{ current.ability === 'grammar' ? '文法' : '単語' }}</span>
      <h1 id="question-title">
        {{ current.prompt }}
      </h1>
      <p class="question-support">
        {{ current.support }}
      </p>
      <fieldset :disabled="submitted || submitting">
        <legend class="sr-only">
          答えを1つ選んでください
        </legend>
        <label
          v-for="choice in current.choices"
          :key="choice"
          class="choice"
          :class="{ selected: selected === choice }"
        >
          <input
            v-model="selected"
            type="radio"
            name="answer"
            :value="choice"
          >
          <span>{{ choice }}</span>
        </label>
      </fieldset>

      <div
        v-if="submitted"
        ref="feedback"
        class="feedback"
        :class="answerCorrect ? 'correct' : 'incorrect'"
        role="status"
        tabindex="-1"
      >
        <strong>{{ answerCorrect ? '正解！' : `正解は「${correctAnswer}」` }}</strong>
        <p>{{ explanation }}</p>
      </div>
      <p
        v-if="serviceError"
        class="field-error"
        role="alert"
      >
        {{ serviceError }}
      </p>

      <button
        v-if="!submitted"
        class="primary-action"
        data-testid="submit-answer"
        type="button"
        :disabled="!selected || submitting"
        @click="submitAnswer"
      >
        {{ submitting ? '送信中…' : '答えを確認する' }}
      </button>
      <button
        v-else
        class="primary-action"
        data-testid="next-question"
        type="button"
        :disabled="submitting"
        @click="next"
      >
        {{ completedScore !== null ? '結果を見る' : '次の問題へ' }}
      </button>
    </article>
  </section>
</template>
