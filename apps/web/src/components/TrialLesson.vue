<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { TrialQuestion } from '../domain/trial'

const props = defineProps<{ questions: TrialQuestion[] }>()
const emit = defineEmits<{ complete: [score: number] }>()
const index = ref(0)
const selected = ref('')
const submitted = ref(false)
const score = ref(0)
const feedback = ref<HTMLElement | null>(null)
const current = computed<TrialQuestion>(() => props.questions[index.value]!)
const progress = computed(() => ((index.value + 1) / props.questions.length) * 100)
const correct = computed(() => selected.value === current.value.answer)

async function submitAnswer() {
  if (!selected.value || submitted.value) return
  submitted.value = true
  if (correct.value) score.value += 1
  await nextTick()
  feedback.value?.focus()
}

function next() {
  if (index.value === props.questions.length - 1) {
    emit('complete', score.value)
    return
  }
  index.value += 1
  selected.value = ''
  submitted.value = false
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
        {{ index + 1 }} / {{ questions.length }}
      </p>
    </header>
    <div
      class="progress-track"
      role="progressbar"
      :aria-valuenow="index + 1"
      aria-valuemin="1"
      :aria-valuemax="questions.length"
      :aria-label="`問題 ${index + 1} / ${questions.length}`"
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
      <fieldset :disabled="submitted">
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
        :class="correct ? 'correct' : 'incorrect'"
        role="status"
        tabindex="-1"
      >
        <strong>{{ correct ? '正解！' : `正解は「${current.answer}」` }}</strong>
        <p>{{ current.explanation }}</p>
      </div>

      <button
        v-if="!submitted"
        class="primary-action"
        data-testid="submit-answer"
        type="button"
        :disabled="!selected"
        @click="submitAnswer"
      >
        答えを確認する
      </button>
      <button
        v-else
        class="primary-action"
        data-testid="next-question"
        type="button"
        @click="next"
      >
        {{ index === questions.length - 1 ? '結果を見る' : '次の問題へ' }}
      </button>
    </article>
  </section>
</template>
