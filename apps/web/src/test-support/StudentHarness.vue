<script setup lang="ts">
// テスト用のハーネス。製品では各ページがルーターで分割されていますが、
// 単体テストでは1つのツリーとしてまとめて検証します。
import StudentExperienceProvider from '../providers/StudentExperienceProvider.vue'
import PresenterBar from '../providers/PresenterBar.vue'
import HomePage from '../pages/HomePage.vue'
import LevelCheckPage from '../pages/LevelCheckPage.vue'
import ReviewPage from '../pages/ReviewPage.vue'
import MapPage from '../pages/MapPage.vue'
import CollectionPage from '../pages/CollectionPage.vue'
import type { CapabilityState, JourneySummary, KnowledgeItem } from '../composables/studentExperience'
import type { DemoSessionResponse } from '../api/demoFlow'

defineProps<{
  session: DemoSessionResponse
  capabilities: CapabilityState | null
  invitationCode: string
  knowledgeItems: KnowledgeItem[]
}>()

defineEmits<{
  refresh: []
  invitationCreated: [code: string]
  knowledgeUpdated: [items: KnowledgeItem[]]
  journeyUpdated: [summary: JourneySummary]
}>()
</script>

<template>
  <StudentExperienceProvider
    :session="session"
    :capabilities="capabilities"
    :invitation-code="invitationCode"
    :knowledge-items="knowledgeItems"
    @refresh="$emit('refresh')"
    @invitation-created="$emit('invitationCreated', $event)"
    @knowledge-updated="$emit('knowledgeUpdated', $event)"
    @journey-updated="$emit('journeyUpdated', $event)"
  >
    <PresenterBar />
    <HomePage />
    <LevelCheckPage />
    <ReviewPage />
    <MapPage />
    <CollectionPage />
  </StudentExperienceProvider>
</template>
