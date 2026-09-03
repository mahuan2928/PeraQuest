<script setup lang="ts">
// 四択。英検3級 大問1 と同じ形です。時間制限は付けません。
// 冠詞センサーの制限時間は「反射で判断する」ことを練習させるための仕掛けで、
// 語彙・文法の四択に同じものを付けると、知っているのに選べなかった回が
// 誤答として窓に入り、測っているものがぶれます。
import { computed } from 'vue'

const props = defineProps<{ prompt: Record<string, unknown>; disabled: boolean }>()
const emit = defineEmits<{ answer: [response: string] }>()

const sentence = computed(() => String(props.prompt.sentence ?? ''))
const choices = computed(() => (props.prompt.choices as string[] | undefined) ?? [])
</script>

<template>
  <div class="mcq-item">
    <p class="item-sentence">
      {{ sentence }}
    </p>
    <div class="mcq-choices">
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
