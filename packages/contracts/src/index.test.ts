import { describe, expect, it } from 'vitest'
import {
  authMethods,
  evidenceSources,
  knowledgeEvidenceOutcomes,
  knowledgeStates,
  remediationReasons,
  remediationTaskStatuses,
  sanitizeErrorDetails,
  stableErrorCodeMetadata,
  stableErrorCodes,
  stageAttemptStatuses,
  stageExamVersionStatuses,
  unlockReasons,
  unlockStatuses,
  userRoles,
  type AuthActor,
  type CurrentDevicePushDisableRequest,
  type CurrentDevicePushDisableResponse,
  type CurrentDeviceRegistrationRequest,
  type CurrentDeviceRegistrationResponse,
  type ErrorResponse,
  type GameRewardGrantDto,
  type GuardianInvitationResponse,
  type GuardianLinkVerificationRequest,
  type GuardianLinkVerificationResponse,
  type GuardianVoiceConsentWriteRequest,
  type GuardianVoiceConsentWriteResponse,
  type KnowledgeEvidenceDto,
  type PublicStageExamItemDto,
  type RemediationTaskDto,
  type StartStageAttemptResponse,
  type StudentGameStateResponse,
  type StudentKnowledgeProjectionDto,
  type StudentKnowledgeProjectionListResponse,
  type SubmitStageAttemptRequest,
  type UnlockStateDto,
  type VoiceUploadTicketRequest,
  type VoiceUploadTicketResponse,
} from './index'

const evidence = {
  evidenceId: 'evidence-1',
  studentId: 'student-1',
  knowledgeNodeId: 'node-1',
  source: 'lesson',
  outcome: 'correct',
  difficulty: null,
  occurredAt: '2026-08-27T00:00:00.000Z',
  idempotencyKey: 'lesson-1',
  payload: {},
  createdAt: '2026-08-27T00:00:00.000Z',
} satisfies KnowledgeEvidenceDto

const remediation = {
  remediationTaskId: 'remediation-1',
  studentId: evidence.studentId,
  knowledgeNodeId: evidence.knowledgeNodeId,
  status: 'open',
  reason: 'lesson_gap',
  dueAt: null,
  completedAt: null,
  sourceEvidenceId: evidence.evidenceId,
} satisfies RemediationTaskDto

const masteryProjection = {
  studentId: evidence.studentId,
  knowledgePointRef: 'vocab-alpha',
  rawCorrectTotal: 3,
  rawAttemptTotal: 5,
  masteryScore: 0.6,
  state: 'review',
  lastOccurredAt: '2026-08-27T00:00:00.000Z',
  dueAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
} satisfies StudentKnowledgeProjectionDto
const masteryProjectionList = { items: [masteryProjection] } satisfies StudentKnowledgeProjectionListResponse
const deviceRegistration = {
  platform: 'ios',
  deviceId: 'device-1',
  appVersion: '1.0.0',
  osVersion: '18',
} satisfies CurrentDeviceRegistrationRequest
const deviceRegistrationResponse = {
  platform: 'ios',
  pushEnabled: false,
  lastSeenAt: '2026-08-30T00:00:00.000Z',
} satisfies CurrentDeviceRegistrationResponse
const devicePushDisable = deviceRegistration satisfies CurrentDevicePushDisableRequest
const devicePushDisableResponse = deviceRegistrationResponse satisfies CurrentDevicePushDisableResponse
const guardianInvitation = {
  inviteCode: 'guardianInviteCode_123',
  expiresAt: '2026-08-31T00:00:00.000Z',
} satisfies GuardianInvitationResponse
const guardianVerificationRequest = {
  inviteCode: guardianInvitation.inviteCode,
} satisfies GuardianLinkVerificationRequest
const guardianVerificationResponse = {
  studentId: evidence.studentId,
  status: 'verified',
  purchaseAllowed: true,
  verifiedAt: '2026-08-30T00:00:00.000Z',
} satisfies GuardianLinkVerificationResponse
const guardianVoiceConsentWrite = {
  status: 'granted',
  version: 'v1',
} satisfies GuardianVoiceConsentWriteRequest
const guardianVoiceConsentResponse = {
  type: 'voice_processing',
  status: guardianVoiceConsentWrite.status,
  version: guardianVoiceConsentWrite.version,
} satisfies GuardianVoiceConsentWriteResponse
const voiceUploadTicketRequest = {
  contentType: 'audio/webm',
  contentLengthBytes: 1024,
  durationSeconds: 12.5,
  checksumSha256: 'a'.repeat(64),
} satisfies VoiceUploadTicketRequest
const voiceUploadTicketResponse = {
  uploadUrl: 'https://storage.example.test/voice-bucket',
  method: 'POST',
  fields: {
    key: 'voice/20260830/student-1/upload',
    policy: 'base64-policy',
    'x-amz-signature': 'signature',
  },
  objectKey: 'voice/20260830/student-1/upload',
  bucket: 'voice-bucket',
  region: 'ap-northeast-1',
  expiresAt: '2026-08-30T00:05:00.000Z',
  maxBytes: 10 * 1024 * 1024,
  maxDurationSeconds: 300,
} satisfies VoiceUploadTicketResponse

const unlock = {
  studentId: evidence.studentId,
  examLevel: 'eiken_grade_3',
  stage: 1,
  status: 'unlocked',
  reason: 'stage_exam_passed',
  updatedAt: '2026-08-27T00:00:00.000Z',
} satisfies UnlockStateDto

const gameReward = {
  source: 'stage_attempt',
  sourceRef: 'attempt-1',
  reason: 'stage_attempt_passed',
  xpAwarded: 100,
  activityCoinsAwarded: 50,
  questStepDelta: 1,
  questChapterUnlocked: 1,
  badgesAwarded: ['level_check_cleared'],
} satisfies GameRewardGrantDto

const gameState = {
  studentId: evidence.studentId,
  totalXp: 100,
  activityCoins: 50,
  questChapter: 1,
  questStep: 1,
  badges: gameReward.badgesAwarded,
  updatedAt: '2026-08-30T00:00:00.000Z',
} satisfies StudentGameStateResponse

describe('shared security contracts', () => {
  it('keeps actor enums explicit and stable', () => {
    expect(userRoles).toEqual(['student', 'guardian', 'admin', 'service'])
    expect(authMethods).toContain('bearer')
    expect(authMethods).toContain('legacy_student_header')
    expect({ id: 'student-1', role: 'student', method: 'bearer' } satisfies AuthActor).toBeDefined()
  })

  it('drops non-whitelisted error detail fields', () => {
    expect(sanitizeErrorDetails({ field: 'version', reason: 'invalid', secret: 'token' })).toEqual({ field: 'version', reason: 'invalid' })
    expect(sanitizeErrorDetails({ resource: 'payment_webhook', reason: 'invalid' })).toEqual({ resource: 'payment_webhook', reason: 'invalid' })
    expect(sanitizeErrorDetails({ message: 'raw provider error' })).toBeUndefined()
    expect({ code: 'AUTH_FORBIDDEN', details: { resource: 'request', reason: 'not_allowed' } } satisfies ErrorResponse).toBeDefined()
  })

  it('exposes a complete stable error-code allowlist', () => {
    expect(new Set(stableErrorCodes).size).toBe(stableErrorCodes.length)
    expect(stableErrorCodes).toEqual(expect.arrayContaining([
      'AUTH_REQUIRED', 'GUARDIAN_AUTH_REQUIRED', 'VOICE_CONSENT_REQUIRED',
      'LEGACY_AUTH_NOT_ALLOWED', 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_REPLAY',
      'IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      'STAGE_EXAM_NOT_AVAILABLE', 'STAGE_ATTEMPT_NOT_FOUND',
      'STAGE_ATTEMPT_ALREADY_OPEN', 'STAGE_ATTEMPT_ALREADY_FINALIZED',
      'STAGE_ATTEMPT_EXPIRED', 'INVALID_STAGE_SUBMISSION',
      'REVISION_CONFLICT', 'INTERNAL_ERROR',
    ]))
  })

  it('retains IDEMPOTENCY_REPLAY for compatibility without making it a P1.1 active error', () => {
    expect(stableErrorCodes).toContain('IDEMPOTENCY_REPLAY')
    expect({ code: 'IDEMPOTENCY_REPLAY' } satisfies ErrorResponse).toBeDefined()
    expect(stableErrorCodeMetadata.IDEMPOTENCY_REPLAY).toEqual({
      deprecated: true,
      compatibilityOnly: true,
      activeInP11: false,
    })
  })

  it('keeps current device registration scoped to metadata without push token', () => {
    expect(deviceRegistration).toMatchObject({ platform: 'ios', deviceId: 'device-1' })
    expect(deviceRegistrationResponse).toMatchObject({ platform: 'ios', pushEnabled: false })
    expect(deviceRegistration).not.toHaveProperty('pushToken')
    expect(devicePushDisableResponse.pushEnabled).toBe(false)
    expect(devicePushDisable).not.toHaveProperty('pushToken')
  })

  it('exposes guardian invite and verification contracts', () => {
    expect(guardianInvitation).toMatchObject({ inviteCode: guardianVerificationRequest.inviteCode })
    expect(guardianVerificationResponse).toMatchObject({ status: 'verified', purchaseAllowed: true })
    expect(guardianVerificationResponse.studentId).toBe(evidence.studentId)
  })

  it('exposes guardian voice consent write contracts', () => {
    expect(guardianVoiceConsentWrite).toEqual({ status: 'granted', version: 'v1' })
    expect(guardianVoiceConsentResponse).toEqual({ type: 'voice_processing', status: 'granted', version: 'v1' })
  })

  it('exposes signed voice upload ticket contracts without secrets', () => {
    expect(voiceUploadTicketRequest.checksumSha256).toHaveLength(64)
    expect(voiceUploadTicketResponse).toMatchObject({ method: 'POST', bucket: 'voice-bucket', region: 'ap-northeast-1' })
    expect(voiceUploadTicketResponse.fields).toHaveProperty('policy')
    expect(voiceUploadTicketResponse.fields).not.toHaveProperty('secretAccessKey')
  })

  it('exposes Quest reward and game-state contracts', () => {
    expect(gameReward).toMatchObject({ source: 'stage_attempt', xpAwarded: 100, activityCoinsAwarded: 50 })
    expect(gameState).toMatchObject({ totalXp: 100, questChapter: 1, badges: ['level_check_cleared'] })
  })
})

describe('learning P1.1 schema contracts', () => {
  const item = {
    itemId: '00000000-0000-0000-0000-000000000101',
    itemRef: 'vocabulary-1',
    ordinal: 1,
    prompt: 'Choose the best answer.',
    support: null,
    options: [
      { optionId: '00000000-0000-0000-0000-000000000102', text: 'A' },
      { optionId: '00000000-0000-0000-0000-000000000103', text: 'B' },
    ],
    points: 1,
  } satisfies PublicStageExamItemDto

  it('keeps version and attempt states aligned with the database schema', () => {
    expect(stageExamVersionStatuses).toEqual(['draft', 'published'])
    expect(stageAttemptStatuses).toEqual(['open', 'passed', 'failed', 'expired'])
  })

  it('exposes public question data without an answer key', () => {
    const response = {
      attemptId: '00000000-0000-0000-0000-000000000104',
      examVersionId: '00000000-0000-0000-0000-000000000105',
      status: 'open',
      startedAt: '2026-08-27T00:00:00.000Z',
      expiresAt: '2026-08-27T00:30:00.000Z',
      passScore: 0.8,
      items: [item],
    } satisfies StartStageAttemptResponse

    expect(response.items[0]).not.toHaveProperty('correctOptionId')
  })

  it('represents an explicit skipped answer with null', () => {
    const request = {
      answers: [{ itemId: item.itemId, selectedOptionId: null }],
    } satisfies SubmitStageAttemptRequest

    expect(request.answers[0]?.selectedOptionId).toBeNull()
  })
})

describe('knowledge-domain contracts', () => {
  it('keeps knowledge evidence vocabulary stable', () => {
    expect(evidenceSources).toEqual(['lesson', 'daily_review', 'stage_exam', 'cross_stage_challenge'])
    expect(knowledgeStates).toEqual(['new', 'learning', 'review', 'mastered', 'suspended'])
    expect(knowledgeEvidenceOutcomes).toEqual(['correct', 'incorrect', 'skipped'])
  })

  it('uses one evidence identity across evidence and remediation DTOs', () => {
    expect(remediation.sourceEvidenceId).toBe(evidence.evidenceId)
  })

  it('exposes the current P1.3-6 mastery projection shape without future fields', () => {
    expect(masteryProjection).toMatchObject({
      knowledgePointRef: 'vocab-alpha',
      masteryScore: 0.6,
      state: 'review',
    })
    expect(masteryProjection).not.toHaveProperty('stabilityDays')
    expect(masteryProjection).not.toHaveProperty('attemptCount')
    expect(masteryProjectionList.items).toEqual([masteryProjection])
  })

  it('keeps remediation and unlock vocabulary stable', () => {
    expect(remediationTaskStatuses).toEqual(['open', 'completed', 'dismissed', 'expired'])
    expect(remediationReasons).toEqual(['lesson_gap', 'review_gap', 'stage_exam_gap', 'challenge_gap'])
    expect(unlockStatuses).toEqual(['locked', 'unlocked', 'completed'])
    expect(unlockReasons).toEqual(['prerequisite', 'stage_exam_passed', 'challenge_passed', 'manual_grant'])
    expect(unlock.studentId).toBe(evidence.studentId)
  })
})
