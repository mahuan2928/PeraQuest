<script setup lang="ts">
// 説明者用のツールバー。製品画面の外側に置き、アプリ本体には
// デモ用の語彙・操作を一切残さないための枠です。
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { studentExperienceKey } from '../composables/studentExperience'

defineProps<{ sessionExpiresAt?: string }>()
const emit = defineEmits<{ reset: [] }>()

const experience = inject(studentExperienceKey)!
const { attempt, resultSummary, busy, fillDemoLevelCheckAnswers, demoGuide, demoMetrics } = experience

const visible = ref(true)
const guideOpen = ref(false)

// 下に続くヘッダーが重ならないよう、このバーの高さを CSS 変数で共有します。
const barRef = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

const publishHeight = () => {
  const height = visible.value && barRef.value ? barRef.value.getBoundingClientRect().height : 0
  document.documentElement.style.setProperty('--presenter-h', `${Math.round(height)}px`)
}

const observeBar = async () => {
  await nextTick()
  observer?.disconnect()
  if (barRef.value) {
    observer = new ResizeObserver(publishHeight)
    observer.observe(barRef.value)
  }
  publishHeight()
}

onMounted(observeBar)
watch(visible, observeBar)
onBeforeUnmount(() => {
  observer?.disconnect()
  document.documentElement.style.removeProperty('--presenter-h')
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="barRef"
      class="presenter-bar"
      role="toolbar"
      aria-label="説明者用ツール"
    >
      <span class="presenter-tag">説明者用</span>
      <p class="presenter-now">
        {{ demoGuide.title }}
      </p>
      <div class="presenter-actions">
        <button
          type="button"
          :aria-expanded="guideOpen"
          @click="guideOpen = !guideOpen"
        >
          進行ガイド
        </button>
        <button
          type="button"
          :disabled="busy || !attempt || Boolean(resultSummary)"
          @click="fillDemoLevelCheckAnswers"
        >
          回答を自動入力
        </button>
        <button
          type="button"
          @click="emit('reset')"
        >
          セッションを再開
        </button>
        <button
          type="button"
          class="presenter-hide"
          aria-label="説明者用ツールを隠します"
          @click="visible = false"
        >
          非表示
        </button>
      </div>
    </div>
    <button
      v-else
      class="presenter-restore"
      type="button"
      @click="visible = true"
    >
      説明者用ツールを表示
    </button>

    <div
      v-if="visible && guideOpen"
      class="presenter-guide"
    >
      <div>
        <span>{{ demoGuide.step }}</span>
        <strong>{{ demoGuide.title }}</strong>
        <p>{{ demoGuide.detail }}</p>
        <p class="presenter-script">
          {{ demoGuide.action }}
        </p>
        <small>{{ demoGuide.talkTrack }}</small>
        <ul>
          <li
            v-for="checkpoint in demoGuide.checkpoints"
            :key="checkpoint"
          >
            {{ checkpoint }}
          </li>
        </ul>
      </div>
      <div class="presenter-metrics">
        <strong>標準デモの口径</strong>
        <article
          v-for="metric in demoMetrics"
          :key="metric.label"
        >
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <p>{{ metric.detail }}</p>
        </article>
      </div>
    </div>
  </Teleport>
</template>
