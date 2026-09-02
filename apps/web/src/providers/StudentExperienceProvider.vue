<script setup lang="ts">
import { provide } from 'vue'
import {
  createStudentExperience,
  studentExperienceKey,
  type CapabilityState,
  type JourneySummary,
  type KnowledgeItem,
} from '../composables/studentExperience'
import type { DemoSessionResponse } from '../api/demoFlow'

const props = defineProps<{
  session: DemoSessionResponse
  capabilities: CapabilityState | null
  invitationCode: string
  knowledgeItems: KnowledgeItem[]
}>()

const emit = defineEmits<{
  refresh: []
  invitationCreated: [code: string]
  knowledgeUpdated: [items: KnowledgeItem[]]
  journeyUpdated: [summary: JourneySummary]
}>()

const experience = createStudentExperience(props, emit)
provide(studentExperienceKey, experience)
const { earnedReward, rewardCelebrationOpen, closeRewardCelebration, badgeLabels, message, error } = experience
</script>

<template>
  <slot />

  <aside
    v-if="earnedReward && rewardCelebrationOpen"
    class="reward-celebration"
    role="status"
    aria-live="polite"
  >
    <div class="reward-burst">
      +
    </div>
    <div>
      <span>報酬を獲得しました</span>
      <strong>クエストが前に進みました</strong>
      <p>学習の結果が、XP・コイン・バッジに変わりました。</p>
      <div class="reward-summary">
        <span>+{{ earnedReward.xpAwarded }} XP</span>
        <span>+{{ earnedReward.activityCoinsAwarded }} コイン</span>
        <span
          v-for="badge in earnedReward.badgesAwarded"
          :key="badge"
        >
          {{ badgeLabels[badge] ?? badge }}
        </span>
      </div>
    </div>
    <button
      class="reward-close"
      type="button"
      aria-label="報酬のお知らせを閉じます"
      @click="closeRewardCelebration"
    >
      閉じる
    </button>
  </aside>

  <p
    v-if="message"
    class="status-note"
    role="status"
  >
    {{ message }}
  </p>
  <p
    v-if="error"
    class="field-error"
    role="alert"
  >
    {{ error }}
  </p>
</template>
