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
  type ErrorResponse,
  type KnowledgeEvidenceDto,
  type PublicStageExamItemDto,
  type RemediationTaskDto,
  type StartStageAttemptResponse,
  type StudentKnowledgeProjectionDto,
  type SubmitStageAttemptRequest,
  type UnlockStateDto,
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

const unlock = {
  studentId: evidence.studentId,
  examLevel: 'eiken_grade_3',
  stage: 1,
  status: 'unlocked',
  reason: 'stage_exam_passed',
  updatedAt: '2026-08-27T00:00:00.000Z',
} satisfies UnlockStateDto

describe('shared security contracts', () => {
  it('keeps actor enums explicit and stable', () => {
    expect(userRoles).toEqual(['student', 'guardian', 'admin', 'service'])
    expect(authMethods).toContain('bearer')
    expect(authMethods).toContain('legacy_student_header')
    expect({ id: 'student-1', role: 'student', method: 'bearer' } satisfies AuthActor).toBeDefined()
  })

  it('drops non-whitelisted error detail fields', () => {
    expect(sanitizeErrorDetails({ field: 'version', reason: 'invalid', secret: 'token' })).toEqual({ field: 'version', reason: 'invalid' })
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
  })

  it('keeps remediation and unlock vocabulary stable', () => {
    expect(remediationTaskStatuses).toEqual(['open', 'completed', 'dismissed', 'expired'])
    expect(remediationReasons).toEqual(['lesson_gap', 'review_gap', 'stage_exam_gap', 'challenge_gap'])
    expect(unlockStatuses).toEqual(['locked', 'unlocked', 'completed'])
    expect(unlockReasons).toEqual(['prerequisite', 'stage_exam_passed', 'challenge_passed', 'manual_grant'])
    expect(unlock.studentId).toBe(evidence.studentId)
  })
})
