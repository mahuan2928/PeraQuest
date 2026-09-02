import type { InjectionKey, Ref } from 'vue'
import type { CapabilityState, KnowledgeItem } from '../composables/studentExperience'
import type { DemoSessionResponse } from '../api/demoFlow'

export interface GuardianContext {
  session: Ref<DemoSessionResponse | null>
  invitationCode: Ref<string>
  capabilities: Ref<CapabilityState | null>
  knowledgeItems: Ref<KnowledgeItem[]>
  studentJourneySummary: Ref<unknown>
  reportRefreshKey: Ref<number>
  onVerified: () => void
  onConsentChanged: () => void
  onKnowledgeUpdated: (items: KnowledgeItem[]) => void
}

export const guardianContextKey: InjectionKey<GuardianContext> = Symbol('guardianContext')
