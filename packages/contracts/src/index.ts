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

export interface CurrentDeviceRegistrationRequest extends ClientContext {
  deviceId: string
}

export interface CurrentDeviceRegistrationResponse {
  platform: ClientPlatform
  pushEnabled: boolean
  lastSeenAt: string
}

export type CurrentDevicePushDisableRequest = CurrentDeviceRegistrationRequest
export type CurrentDevicePushDisableResponse = CurrentDeviceRegistrationResponse

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

export interface GuardianInvitationResponse {
  inviteCode: string
  expiresAt: string
}

export interface GuardianLinkVerificationRequest {
  inviteCode: string
}

export interface GuardianLinkVerificationResponse extends GuardianLinkResponse {
  studentId: string
}

export interface ConsentResponse {
  type: 'voice_processing'
  status: ConsentStatus
  version: string | null
}

export interface GuardianVoiceConsentWriteRequest {
  status: Exclude<ConsentStatus, 'missing' | 'outdated'>
  version: string
}

export type GuardianVoiceConsentWriteResponse = ConsentResponse

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

export interface VoiceUploadTicketRequest {
  contentType: 'audio/webm' | 'audio/mpeg' | 'audio/mp4' | 'audio/wav' | 'audio/x-m4a'
  contentLengthBytes: number
  durationSeconds: number
  checksumSha256: string
}

export interface VoiceUploadTicketResponse {
  uploadUrl: string
  method: 'POST'
  fields: Record<string, string>
  objectKey: string
  bucket: string
  region: string
  expiresAt: string
  maxBytes: number
  maxDurationSeconds: number
}

export const stageExamVersionStatuses = ['draft', 'published'] as const
export type StageExamVersionStatus = (typeof stageExamVersionStatuses)[number]

export const stageAttemptStatuses = ['open', 'passed', 'failed', 'expired'] as const
export type StageAttemptStatus = (typeof stageAttemptStatuses)[number]

export interface PublicStageExamOptionDto {
  optionId: string
  text: string
}

export interface PublicStageExamItemDto {
  itemId: string
  itemRef: string
  ordinal: number
  prompt: string
  support: string | null
  options: PublicStageExamOptionDto[]
  points: number
}

/** Contract only: the P1.1 slice does not register a start runtime route. */
export interface StartStageAttemptResponse {
  attemptId: string
  examVersionId: string
  status: 'open'
  startedAt: string
  expiresAt: string
  passScore: number
  items: PublicStageExamItemDto[]
}

/** Formal P1.3 submit runtime request. The server ignores any client score/result fields. */
export interface SubmitStageAttemptRequest {
  answers: Array<{
    itemId: string
    selectedOptionId: string | null
  }>
}

export interface StageAttemptResultItemDto {
  itemId: string
  outcome: KnowledgeEvidenceOutcome
  earnedScore: number
  maxScore: number
  /** 採点後にだけ返します。どこを間違えたのかを見直すための情報です。 */
  prompt: string
  selectedText: string | null
  correctText: string
}

export type GameRewardSource = 'stage_attempt' | 'guardian_verification' | 'daily_session'
export type GameRewardReason = 'stage_attempt_passed' | 'stage_attempt_completed' | 'guardian_link_verified' | 'daily_session_completed'

export interface GameRewardGrantDto {
  source: GameRewardSource
  sourceRef: string
  reason: GameRewardReason
  xpAwarded: number
  activityCoinsAwarded: number
  questStepDelta: number
  questChapterUnlocked: number | null
  badgesAwarded: string[]
}

export interface StageAttemptResultResponse {
  attemptId: string
  status: 'passed' | 'failed'
  submittedAt: string
  rawScore: number
  maxScore: number
  score: number
  passed: boolean
  passScore: number
  items: StageAttemptResultItemDto[]
  rewards?: GameRewardGrantDto
}

export interface StudentGameStateResponse {
  studentId: string
  totalXp: number
  activityCoins: number
  questChapter: number
  questStep: number
  badges: string[]
  updatedAt: string
}

export interface GuardianLearningSummaryItem {
  knowledgePointRef: string
  label: string
  masteryPercent: number
  state: StudentKnowledgeProjectionState
}

export interface GuardianLearningSummaryResponse {
  studentId: string
  generatedAt: string
  overview: {
    headline: string
    weeklyActivityLabel: string
    averageMasteryPercent: number
    reviewItemCount: number
    masteredItemCount: number
  }
  strengths: GuardianLearningSummaryItem[]
  reviewFocus: GuardianLearningSummaryItem[]
  quest: {
    totalXp: number
    activityCoins: number
    questChapter: number
    questStep: number
    badges: string[]
    summary: string
  }
  nextRecommendation: string
}

/** Contract-only knowledge-domain vocabulary. These DTOs do not imply runtime APIs or persistence. */
export const knowledgeStates = ['new', 'learning', 'review', 'mastered', 'suspended'] as const
export type KnowledgeState = (typeof knowledgeStates)[number]

export const evidenceSources = ['lesson', 'daily_review', 'stage_exam', 'cross_stage_challenge'] as const
export type EvidenceSource = (typeof evidenceSources)[number]

export const knowledgeEvidenceOutcomes = ['correct', 'incorrect', 'skipped'] as const
export type KnowledgeEvidenceOutcome = (typeof knowledgeEvidenceOutcomes)[number]

export const remediationTaskStatuses = ['open', 'completed', 'dismissed', 'expired'] as const
export type RemediationTaskStatus = (typeof remediationTaskStatuses)[number]

export const remediationReasons = ['lesson_gap', 'review_gap', 'stage_exam_gap', 'challenge_gap'] as const
export type RemediationReason = (typeof remediationReasons)[number]

export const unlockStatuses = ['locked', 'unlocked', 'completed'] as const
export type UnlockStatus = (typeof unlockStatuses)[number]

export const unlockReasons = ['prerequisite', 'stage_exam_passed', 'challenge_passed', 'manual_grant'] as const
export type UnlockReason = (typeof unlockReasons)[number]

export interface KnowledgeNodeDto {
  knowledgeNodeId: string
  examLevel: ExamLevel
  skill: string
  code: string
  title: string
  version: string
  status: 'draft' | 'published' | 'retired'
  prerequisiteIds: string[]
}

export interface StudentKnowledgeDto {
  studentId: string
  knowledgeNodeId: string
  state: KnowledgeState
  masteryScore: number
  stabilityDays: number
  dueAt: string | null
  attemptCount: number
  correctCount: number
  lastAttemptAt: string | null
  version: string
}

export type StudentKnowledgeProjectionState = 'learning' | 'review' | 'mastered'

/** Current P1.3-6 mastery/due projection. This mirrors `student_knowledge`; it does not imply a read API. */
export interface StudentKnowledgeProjectionDto {
  studentId: string
  knowledgePointRef: string
  rawCorrectTotal: number
  rawAttemptTotal: number
  masteryScore: number
  state: StudentKnowledgeProjectionState
  lastOccurredAt: string
  dueAt: string
  updatedAt: string
}

export interface StudentKnowledgeProjectionListResponse {
  items: StudentKnowledgeProjectionDto[]
}

/** Camel-case DTO projection of the append-only `knowledge_evidence` record. */
export interface KnowledgeEvidenceDto {
  evidenceId: string
  studentId: string
  knowledgeNodeId: string
  source: EvidenceSource
  outcome: KnowledgeEvidenceOutcome
  difficulty: number | null
  occurredAt: string
  idempotencyKey: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface RemediationTaskDto {
  remediationTaskId: string
  studentId: string
  knowledgeNodeId: string
  status: RemediationTaskStatus
  reason: RemediationReason
  dueAt: string | null
  completedAt: string | null
  sourceEvidenceId: KnowledgeEvidenceDto['evidenceId'] | null
}

export interface UnlockStateDto {
  studentId: string
  examLevel: ExamLevel
  stage: number
  status: UnlockStatus
  reason: UnlockReason
  updatedAt: string
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
  providerSubject?: string
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
  'DAILY_SESSION_NOT_AVAILABLE',
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
  'PAYMENT_WEBHOOK_NOT_CONFIGURED',
  'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
  'PAYMENT_WEBHOOK_UNSUPPORTED_EVENT',
  'LEGACY_AUTH_NOT_ALLOWED',
  'IDEMPOTENCY_KEY_REQUIRED',
  // Deprecated compatibility-only value retained for existing consumers; P1.1 must not emit it.
  'IDEMPOTENCY_REPLAY',
  'IDEMPOTENCY_KEY_INVALID',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  'STAGE_EXAM_NOT_AVAILABLE',
  'STAGE_ATTEMPT_NOT_FOUND',
  'STAGE_ATTEMPT_ALREADY_OPEN',
  'STAGE_ATTEMPT_ALREADY_FINALIZED',
  'STAGE_ATTEMPT_EXPIRED',
  'INVALID_STAGE_SUBMISSION',
  'REVISION_REQUIRED',
  'REVISION_CONFLICT',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
] as const
export type StableErrorCode = (typeof stableErrorCodes)[number]

export const stableErrorCodeMetadata = {
  IDEMPOTENCY_REPLAY: {
    deprecated: true,
    compatibilityOnly: true,
    activeInP11: false,
  },
} as const satisfies Partial<Record<StableErrorCode, {
  deprecated: boolean
  compatibilityOnly: boolean
  activeInP11: boolean
}>>

/** Deliberately fixed, non-sensitive fields; do not pass raw validation/provider errors. */
export interface SafeErrorDetails {
  field?: string
  reason?: 'invalid' | 'missing' | 'expired' | 'conflict' | 'not_allowed'
  resource?: 'student' | 'guardian_link' | 'consent' | 'trial_attempt' | 'request' | 'stage_exam' | 'stage_attempt' | 'submission' | 'payment_webhook'
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
const safeDetailResources = ['student', 'guardian_link', 'consent', 'trial_attempt', 'request', 'stage_exam', 'stage_attempt', 'submission', 'payment_webhook'] as const

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

/** 毎日ループで出題される 1 問。正解は含めません（採点はサーバー側）。 */
export const dailyItemKinds = ['word_order', 'article', 'katakana'] as const
export type DailyItemKind = (typeof dailyItemKinds)[number]

export interface DailyItemDto {
  contentItemId: string
  itemKind: DailyItemKind
  knowledgePointRef: string
  isReview: boolean
  /** 題型ごとの提示内容。正解・解説は採点後にのみ返します。 */
  prompt: Record<string, unknown>
}

export interface DailySessionDto {
  sessionId: string
  sessionDate: string
  status: 'open' | 'completed' | 'expired'
  targetCount: number
  completedCount: number
  reviewCount: number
}

export interface DailyPlanResponse {
  sessionDate: string
  lives: number
  maxLives: number
  /** 体力が尽きた状態。学習は止めず、ヒントを出せるモードに切り替えます。 */
  supportMode: boolean
  /** 次に生命値が 1 回復する時刻。満タンのときは null。 */
  nextLifeAt: string | null
  reviewCap: number
  session: DailySessionDto | null
}

export interface DailySessionStartResponse {
  session: DailySessionDto
  items: DailyItemDto[]
}

export interface DailyAnswerRequest {
  contentItemId: string
  /** 語順は語の配列、冠詞・和製英語は選択肢の文字列。無解答は null。 */
  response: string | string[] | null
  timedOut?: boolean
}

export interface DailyAnswerResponse {
  correct: boolean
  timedOut: boolean
  explanation: string
  lives: number
  session: DailySessionDto
  supportMode: boolean
  /** 関卡を終えたときだけ入ります。 */
  rewards?: GameRewardGrantDto
}

/** 体力が尽きているときだけ受け取れるヒント。正解そのものは返しません。 */
export interface DailyHintResponse {
  contentItemId: string
  hint: string
}
