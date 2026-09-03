<script setup lang="ts">
// 語順ブロック。ドラッグではなく「押して置く」方式にしています。
// 触っても、キーボードだけでも同じ操作ができ、並べ替えは矢印キーで行えます。
import { computed, ref, watch } from 'vue'

const props = defineProps<{ prompt: Record<string, unknown>; disabled: boolean }>()
const emit = defineEmits<{ answer: [response: string[]] }>()

const blocks = computed(() => (props.prompt.blocks as string[] | undefined) ?? [])
const japanese = computed(() => String(props.prompt.japanese ?? ''))
const placed = ref<number[]>([])

watch(() => props.prompt, () => { placed.value = [] })

const remaining = computed(() => blocks.value.map((_, index) => index).filter((index) => !placed.value.includes(index)))
const sentence = computed(() => placed.value.map((index) => blocks.value[index]!))
const complete = computed(() => placed.value.length === blocks.value.length)

const place = (index: number) => { if (!props.disabled) placed.value = [...placed.value, index] }
const remove = (position: number) => { if (!props.disabled) placed.value = placed.value.filter((_, i) => i !== position) }
const move = (position: number, direction: -1 | 1) => {
  const target = position + direction
  if (props.disabled || target < 0 || target >= placed.value.length) return
  const next = [...placed.value]
  ;[next[position], next[target]] = [next[target]!, next[position]!]
  placed.value = next
}
</script>

<template>
  <div class="word-order">
    <p class="item-japanese">
      {{ japanese }}
    </p>

    <div
      class="word-order-sentence"
      role="list"
      :aria-label="`組み立てた文（${sentence.length} 語）`"
    >
      <p
        v-if="!placed.length"
        class="word-order-empty"
      >
        下の語を押して、英語の順に並べましょう。
      </p>
      <div
        v-for="(word, position) in sentence"
        :key="`${word}-${position}`"
        class="word-chip placed"
        role="listitem"
      >
        <button
          type="button"
          :disabled="disabled"
          :aria-label="`${word} を取り消す`"
          @click="remove(position)"
        >
          {{ word }}
        </button>
        <span class="word-chip-move">
          <button
            type="button"
            :disabled="disabled || position === 0"
            :aria-label="`${word} を前へ移動`"
            @click="move(position, -1)"
          >‹</button>
          <button
            type="button"
            :disabled="disabled || position === sentence.length - 1"
            :aria-label="`${word} を後ろへ移動`"
            @click="move(position, 1)"
          >›</button>
        </span>
      </div>
    </div>

    <div
      class="word-order-bank"
      aria-label="使える語"
    >
      <button
        v-for="index in remaining"
        :key="index"
        type="button"
        class="word-chip"
        :disabled="disabled"
        @click="place(index)"
      >
        {{ blocks[index] }}
      </button>
    </div>

    <button
      class="primary-action"
      type="button"
      :disabled="disabled || !complete"
      @click="emit('answer', sentence)"
    >
      {{ complete ? 'この順番で答えます' : `あと ${blocks.length - placed.length} 語` }}
    </button>
  </div>
</template>
