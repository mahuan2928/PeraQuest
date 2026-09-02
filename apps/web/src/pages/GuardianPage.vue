<script setup lang="ts">
import { inject } from 'vue'
import GuardianApp from '../views/GuardianApp.vue'
import { guardianContextKey } from '../providers/guardianContext'

const guardian = inject(guardianContextKey)!
</script>

<template>
  <GuardianApp
    v-if="guardian.session.value"
    :session="guardian.session.value"
    :invitation-code="guardian.invitationCode.value"
    :capabilities="guardian.capabilities.value"
    :knowledge-items="guardian.knowledgeItems.value"
    :student-journey-summary="guardian.studentJourneySummary.value as never"
    :report-refresh-key="guardian.reportRefreshKey.value"
    @verified="guardian.onVerified"
    @consent-changed="guardian.onConsentChanged"
    @knowledge-updated="guardian.onKnowledgeUpdated"
  />
</template>
