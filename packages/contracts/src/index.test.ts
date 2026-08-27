import { describe, expect, it } from 'vitest'
import {
  authMethods,
  evidenceSources,
  knowledgeEvidenceOutcomes,
  knowledgeStates,
  remediationReasons,
  remediationTaskStatuses,
  sanitizeErrorDetails,
  stableErrorCodes,
  unlockReasons,
  unlockStatuses,
  userRoles,
  type AuthActor,
  type ErrorResponse,
  type KnowledgeEvidenceDto,
  type RemediationTaskDto,
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
      'IDEMPOTENCY_REPLAY', 'REVISION_CONFLICT', 'INTERNAL_ERROR',
    ]))
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

  it('keeps remediation and unlock vocabulary stable', () => {
    expect(remediationTaskStatuses).toEqual(['open', 'completed', 'dismissed', 'expired'])
    expect(remediationReasons).toEqual(['lesson_gap', 'review_gap', 'stage_exam_gap', 'challenge_gap'])
    expect(unlockStatuses).toEqual(['locked', 'unlocked', 'completed'])
    expect(unlockReasons).toEqual(['prerequisite', 'stage_exam_passed', 'challenge_passed', 'manual_grant'])
    expect(unlock.studentId).toBe(evidence.studentId)
  })
})
