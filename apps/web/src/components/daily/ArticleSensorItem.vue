<script setup lang="ts">
// 冠詞センサー。制限時間つきですが、時間切れは「わからなかった」ではなく
// 「時間内に選べなかった」として扱い、知識の誤りにはしません。
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ prompt: Record<string, unknown>; disabled: boolean }>()
const emit = defineEmits<{ answer: [response: string]; timeout: [] }>()

const sentence = computed(() => String(props.prompt.sentence ?? ''))
const choices = computed(() => (props.prompt.choices as string[] | undefined) ?? [])
const limit = computed(() => Number(props.prompt.timeLimitSeconds ?? 12))
const remaining = ref(limit.value)
let timer: number | undefined

const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined } }

const start = () => {
  stop()
  remaining.value = limit.value
  if (props.disabled) return
  timer = window.setInterval(() => {
    remaining.value -= 1
    if (remaining.value <= 0) { stop(); emit('timeout') }
  }, 1000)
}

watch(() => props.prompt, start, { immediate: true })
watch(() => props.disabled, (value) => { if (value) stop() })
onBeforeUnmount(stop)

const percent = computed(() => Math.max(0, Math.round((remaining.value / limit.value) * 100)))
</script>

<template>
  <div class="article-sensor">
    <div
      class="article-timer"
      role="timer"
      :aria-label="`のこり ${Math.max(0, remaining)} 秒`"
    >
      <span :style="{ width: `${percent}%` }" />
    </div>
    <p class="article-remaining">
      のこり {{ Math.max(0, remaining) }} 秒
    </p>

    <p class="item-sentence">
      {{ sentence }}
    </p>

    <div class="article-choices">
      <button
        v-for="choice in choices"
        :key="choice"
        type="button"
        class="secondary-action"
        :disabled="disabled"
        @click="emit('answer', choice)"
      >
        {{ choice }}
      </button>
    </div>
  </div>
</template>
