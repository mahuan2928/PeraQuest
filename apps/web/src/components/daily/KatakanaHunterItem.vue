<script setup lang="ts">
// 和製英語ハンター。片仮名語を、英語として自然な言い方に置き換えます。
import { computed } from 'vue'

const props = defineProps<{ prompt: Record<string, unknown>; disabled: boolean }>()
const emit = defineEmits<{ answer: [response: string] }>()

const katakana = computed(() => String(props.prompt.katakana ?? ''))
const choices = computed(() => (props.prompt.choices as string[] | undefined) ?? [])
</script>

<template>
  <div class="katakana-hunter">
    <p class="item-lead">
      この言葉を英語で言うなら？
    </p>
    <p class="katakana-word">
      {{ katakana }}
    </p>
    <div class="katakana-choices">
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
