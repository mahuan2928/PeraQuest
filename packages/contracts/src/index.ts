export const examLevels = ['eiken_grade_3'] as const
export type ExamLevel = (typeof examLevels)[number]

export const clientPlatforms = ['ios', 'android', 'pc'] as const
export type ClientPlatform = (typeof clientPlatforms)[number]

export const authProviders = ['apple', 'google', 'email_magic_link'] as const
export type AuthProvider = (typeof authProviders)[number]

export const guardianLinkStatuses = ['not_required', 'pending', 'verified', 'rejected', 'revoked'] as const
export type GuardianLinkStatus = (typeof guardianLinkStatuses)[number]

export const consentStatuses = ['missing', 'granted', 'denied', 'withdrawn', 'outdated'] as const
export type ConsentStatus = (typeof consentStatuses)[number]

export const paymentChannels = ['apple_app_store', 'google_play', 'web_checkout'] as const
export type PaymentChannel = (typeof paymentChannels)[number]

export const notificationChannels = ['ios_push', 'android_push', 'web_push', 'line'] as const
export type NotificationChannel = (typeof notificationChannels)[number]

export const interviewPhases = ['greeting', 'reading_aloud', 'passage_questions', 'picture_questions', 'personal_questions', 'result'] as const
export type InterviewPhase = (typeof interviewPhases)[number]

export interface ClientContext {
  platform: ClientPlatform
  deviceId?: string
  appVersion?: string
  osVersion?: string
}

export interface StudentOnboardingRequest {
  birthMonth: string
  targetExam: ExamLevel
  authProvider: AuthProvider
  client: ClientContext
}

export interface StudentOnboardingResponse {
  studentId: string
  isMinor: boolean
  guardianLinkStatus: GuardianLinkStatus
  onboardingStatus: 'pending_guardian' | 'active'
}

export interface GuardianLinkResponse {
  status: GuardianLinkStatus
  purchaseAllowed: boolean
  verifiedAt: string | null
}

export interface ConsentResponse {
  type: 'voice_processing'
  status: ConsentStatus
  version: string | null
}

export interface CapabilityResponse {
  examLevel: ExamLevel
  platform: ClientPlatform
  canLearn: boolean
  canUploadVoice: boolean
  voiceUploadMode: 'disabled' | 'signed_upload'
  canPurchase: boolean
  guardianLinkStatus: GuardianLinkStatus
  voiceConsentStatus: ConsentStatus
  consentVersionRequired: string
  paymentChannels: PaymentChannel[]
  notificationChannels: NotificationChannel[]
  lineReturnTargets: Array<'app_deep_link' | 'web_https'>
  entitlements: string[]
}
