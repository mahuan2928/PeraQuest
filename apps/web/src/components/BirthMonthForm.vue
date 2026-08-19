<script setup lang="ts">
import { computed, ref } from 'vue'

defineProps<{ submitting?: boolean; submitError?: string }>()
const emit = defineEmits<{ submit: [birthMonth: string] }>()
const birthMonth = ref('')
const attempted = ref(false)
const maxMonth = new Date().toISOString().slice(0, 7)
const valid = computed(() => /^\d{4}-\d{2}$/.test(birthMonth.value) && birthMonth.value <= maxMonth)

function submit() {
  attempted.value = true
  if (valid.value) emit('submit', birthMonth.value)
}
</script>

<template>
  <section
    class="onboarding-panel"
    aria-labelledby="welcome-title"
  >
    <div
      class="quest-mark"
      aria-hidden="true"
    >
      Q
    </div>
    <p class="eyebrow">
      EIKEN GRADE 3 · FIRST QUEST
    </p>
    <h1 id="welcome-title">
      今日の3分が、<br><span>自信に変わる。</span>
    </h1>
    <p class="lead">
      英検3級に向けて、あなたに合う冒険を準備します。
    </p>

    <form
      class="birth-form"
      novalidate
      @submit.prevent="submit"
    >
      <div class="field-heading">
        <label for="birth-month">生まれた年月</label>
        <span>必須</span>
      </div>
      <input
        id="birth-month"
        v-model="birthMonth"
        data-testid="birth-month"
        type="month"
        :max="maxMonth"
        aria-describedby="birth-help birth-error"
        :aria-invalid="attempted && !valid"
      >
      <p
        id="birth-help"
        class="field-help"
      >
        年齢に合った安全な設定のために使います。氏名・学校名・地域は入力しません。
      </p>
      <p
        v-if="attempted && !valid"
        id="birth-error"
        class="field-error"
        role="alert"
      >
        正しい生年月を入力してください。
      </p>
      <button
        class="primary-action"
        data-testid="onboarding-submit"
        type="submit"
        :disabled="submitting"
      >
        {{ submitting ? '安全設定を確認中…' : '冒険をはじめる' }} <span aria-hidden="true">→</span>
      </button>
      <p
        v-if="submitError"
        class="field-error"
        role="alert"
      >
        {{ submitError }}
      </p>
    </form>
    <p class="privacy-note">
      <span aria-hidden="true">●</span> 入力情報は安全設定の判定にのみ使用します
    </p>
  </section>
</template>
