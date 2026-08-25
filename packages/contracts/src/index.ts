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

export interface TrialQuestion {
  id: string
  ability: 'vocabulary' | 'grammar'
  prompt: string
  support: string
  choices: string[]
}

export interface TrialAttemptResponse {
  attemptId: string
  questionCount: number
  question: TrialQuestion
  expiresAt: string
  progressPersisted: false
}

export interface TrialAnswerRequest {
  questionId: string
  answer: string
}

export interface TrialAnswerResponse {
  correct: boolean
  correctAnswer: string
  explanation: string
  completed: boolean
  nextQuestion: TrialQuestion | null
  score: number | null
  progressPersisted: false
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

export const userRoles = ['student', 'guardian', 'admin', 'service'] as const
export type UserRole = (typeof userRoles)[number]

export const authMethods = ['bearer', 'legacy_student_header', 'legacy_guardian_header', 'service_token'] as const
export type AuthMethod = (typeof authMethods)[number]

/** Server-resolved actor. Never accept role or subject from an unverified client payload. */
export interface AuthActor {
  id: string
  role: UserRole
  method: AuthMethod
}

export interface AuthorizationProjection {
  canLearn: boolean
  canUploadVoice: boolean
  canPurchase: boolean
}

export interface GuardianLinkProjection {
  studentId: string
  status: GuardianLinkStatus
  revision: number
  authorization: AuthorizationProjection
  guardianId?: string | null
  verifiedAt?: string | null
}

export type ConsentType = 'voice_processing'

export interface ConsentProjection {
  studentId: string
  type: ConsentType
  status: ConsentStatus
  version: string | null
  revision: number
  actor: AuthActor | null
  recordedAt?: string | null
}

export const stableErrorCodes = [
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_FORBIDDEN',
  'CORS_ORIGIN_DENIED',
  'INVALID_ONBOARDING',
  'INVALID_BIRTH_MONTH',
  'INVALID_CLIENT_PLATFORM',
  'INVALID_CONSENT_VERSION',
  'INVALID_TRIAL_ANSWER',
  'STUDENT_NOT_FOUND',
  'GUARDIAN_VERIFICATION_REQUIRED',
  'GUARDIAN_AUTH_REQUIRED',
  'TRIAL_NOT_AVAILABLE',
  'TRIAL_ALREADY_REDEEMED',
  'TRIAL_ATTEMPT_NOT_FOUND',
  'TRIAL_ATTEMPT_EXPIRED',
  'TRIAL_ANSWER_OUT_OF_SEQUENCE',
  'TRIAL_ANSWER_ALREADY_SUBMITTED',
  'VOICE_CONSENT_REQUIRED',
  'SIGNED_UPLOAD_NOT_CONFIGURED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_REPLAY',
  'REVISION_REQUIRED',
  'REVISION_CONFLICT',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
] as const
export type StableErrorCode = (typeof stableErrorCodes)[number]

/** Deliberately fixed, non-sensitive fields; do not pass raw validation/provider errors. */
export interface SafeErrorDetails {
  field?: string
  reason?: 'invalid' | 'missing' | 'expired' | 'conflict' | 'not_allowed'
  resource?: 'student' | 'guardian_link' | 'consent' | 'trial_attempt' | 'request'
  revision?: number
  retryAfterSeconds?: number
}

export interface ErrorResponse {
  code: StableErrorCode
  details?: SafeErrorDetails
}

export const legacyHeaderDeprecation = {
  headers: ['x-student-id', 'x-guardian-id'],
  sunset: '2027-01-01',
  replacement: 'Authorization: Bearer <token>',
} as const

const safeDetailReasons = ['invalid', 'missing', 'expired', 'conflict', 'not_allowed'] as const
const safeDetailResources = ['student', 'guardian_link', 'consent', 'trial_attempt', 'request'] as const

/** Keep error payloads deterministic and prevent raw validation/provider data from escaping. */
export function sanitizeErrorDetails(input: unknown): SafeErrorDetails | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  const details: SafeErrorDetails = {}
  if (typeof value.field === 'string') details.field = value.field
  if (typeof value.reason === 'string' && (safeDetailReasons as readonly string[]).includes(value.reason)) details.reason = value.reason as Exclude<SafeErrorDetails['reason'], undefined>
  if (typeof value.resource === 'string' && (safeDetailResources as readonly string[]).includes(value.resource)) details.resource = value.resource as Exclude<SafeErrorDetails['resource'], undefined>
  if (typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision >= 0) details.revision = value.revision
  if (typeof value.retryAfterSeconds === 'number' && Number.isInteger(value.retryAfterSeconds) && value.retryAfterSeconds >= 0) details.retryAfterSeconds = value.retryAfterSeconds
  return Object.keys(details).length > 0 ? details : undefined
}
