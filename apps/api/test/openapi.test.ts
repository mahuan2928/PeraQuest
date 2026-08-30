import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface OpenApiDocument {
  openapi: string
  paths: Record<string, Record<string, { operationId?: string; parameters?: Array<{ $ref?: string }>; security?: unknown }>>
  components: { parameters: Record<string, { required?: boolean; description?: string; deprecated?: boolean; schema?: Record<string, unknown> }>; schemas: Record<string, Record<string, unknown>>; securitySchemes: Record<string, { description?: string }> }
  ['x-runtime-contract-status']?: Record<string, string>
}

describe('OpenAPI document', () => {
  it('is valid JSON and documents every route in the first vertical slice', async () => {
    const document = JSON.parse(await readFile(resolve(process.cwd(), '../../docs/api/openapi.json'), 'utf8')) as OpenApiDocument
    expect(document.openapi).toBe('3.1.0')
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/v1/stage-attempts/{stageAttemptId}',
      '/api/v1/stage-attempts/{stageAttemptId}/result',
      '/api/v1/stage-attempts/{stageAttemptId}/submit',
      '/api/v1/stage-exams/{stageExamId}/attempts',
      '/api/v1/student-knowledge',
      '/health',
      '/v1/me/capabilities',
      '/v1/me/consents/voice-processing',
      '/v1/me/guardian-link',
      '/v1/me/voice-upload-ticket',
      '/v1/students/onboarding',
      '/v1/trial-attempts',
      '/v1/trial-attempts/{attemptId}/answers',
    ])
    const operationIds = Object.values(document.paths).flatMap((path) => Object.values(path).map(({ operationId }) => operationId))
    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(document.components.parameters).toHaveProperty('ClientPlatform')
    expect(document.components.parameters).toHaveProperty('GuardianId')
    expect(document.components.parameters.IdempotencyKey!).toMatchObject({
      required: false,
      schema: { minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
    })
    expect(document.components.parameters.IdempotencyKey!.description).toContain('formal stage-attempt start runtime')
    expect(document.components.parameters.FormalIdempotencyKey!).toMatchObject({
      required: true,
      schema: { minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
    })
    expect(document.components.parameters.LegacyGuardianHeader).toBeDefined()
    expect(document.components.parameters.IfMatchRevision!).toMatchObject({ required: false })
    expect(document.components.parameters.IfMatchRevision!.description).toContain('planned')
    expect(document.components.parameters.IfMatchRevision!.description).toContain('Not implemented')
    expect(document.components.schemas).toHaveProperty('AuthActor')
    expect(document.components.schemas).toHaveProperty('GuardianLinkProjection')
    expect(document.components.schemas).toHaveProperty('ConsentProjection')
    expect(document.components.schemas).toHaveProperty('ErrorResponse')
    expect(document.components.schemas.StableErrorCode).toMatchObject({
      enum: expect.arrayContaining(['IDEMPOTENCY_REPLAY']),
      description: expect.stringContaining('deprecated and retained only for compatibility'),
      'x-deprecated-values': ['IDEMPOTENCY_REPLAY'],
      'x-compatibility-only-values': ['IDEMPOTENCY_REPLAY'],
    })
    expect(document.components.schemas).toHaveProperty('PublicStageExamOption')
    expect(document.components.schemas).toHaveProperty('PublicStageExamItem')
    expect(document.components.schemas).toHaveProperty('StartStageAttemptResponse')
    expect(document.components.schemas).toHaveProperty('SubmitStageAttemptRequest')
    expect(document.components.schemas).toHaveProperty('StageAttemptResultResponse')
    expect(document.components.schemas).toHaveProperty('StudentKnowledgeProjection')
    expect(document.components.schemas).toHaveProperty('StudentKnowledgeProjectionListResponse')
    expect(document.components.schemas.StudentKnowledgeProjection?.properties).not.toHaveProperty('stabilityDays')
    expect(document.components.schemas.StudentKnowledgeProjection?.properties).not.toHaveProperty('attemptCount')
    expect((document.components.schemas.SubmitStageAttemptRequest?.properties as { answers?: { minItems?: number; maxItems?: number } }).answers).toMatchObject({ minItems: 1, maxItems: 200 })
    expect(document.components.schemas.PublicStageExamItem?.properties).not.toHaveProperty('correctOptionId')
    expect(document.components.schemas).not.toHaveProperty('MasteryUpdate')
    expect(document.components.schemas).not.toHaveProperty('KnowledgeEvidence')
    expect(document.paths).not.toHaveProperty('/v1/me/stage-exams/{examVersionId}/attempts')
    expect(document.paths).not.toHaveProperty('/v1/me/stage-attempts/{attemptId}/submit')
    expect(document.components.securitySchemes).toHaveProperty('BearerAuth')
    expect(document.components.securitySchemes).toHaveProperty('LegacyGuardianHeader')
    const writeOperations = Object.values(document.paths).flatMap((item) => Object.entries(item).filter(([method]) => ['post', 'put', 'patch', 'delete'].includes(method)).map(([, operation]) => operation as { parameters?: Array<{ $ref?: string }>; security?: unknown }))
    expect(writeOperations.every((operation) => operation.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey' || parameter.$ref === '#/components/parameters/FormalIdempotencyKey'))).toBe(true)
    const startStageAttemptOperation = document.paths['/api/v1/stage-exams/{stageExamId}/attempts']?.post
    const putVoiceConsentOperation = document.paths['/v1/me/consents/voice-processing']?.put
    const getStageAttemptOperation = document.paths['/api/v1/stage-attempts/{stageAttemptId}']?.get
    const submitStageAttemptOperation = document.paths['/api/v1/stage-attempts/{stageAttemptId}/submit']?.post
    const getStageAttemptResultOperation = document.paths['/api/v1/stage-attempts/{stageAttemptId}/result']?.get
    const listStudentKnowledgeOperation = document.paths['/api/v1/student-knowledge']?.get
    expect(startStageAttemptOperation).toBeDefined()
    expect(putVoiceConsentOperation).toBeDefined()
    expect(getStageAttemptOperation).toBeDefined()
    expect(submitStageAttemptOperation).toBeDefined()
    expect(getStageAttemptResultOperation).toBeDefined()
    expect(listStudentKnowledgeOperation).toBeDefined()
    expect(putVoiceConsentOperation!.security).toContainEqual({ BearerAuth: [] })
    expect(startStageAttemptOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(startStageAttemptOperation!.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/FormalIdempotencyKey')).toBe(true)
    expect(getStageAttemptOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(submitStageAttemptOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(submitStageAttemptOperation!.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/FormalIdempotencyKey')).toBe(true)
    expect(getStageAttemptResultOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(listStudentKnowledgeOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(document.components.securitySchemes.BearerAuth).toMatchObject({ description: expect.stringContaining('Required for formal stage-attempt runtime') })
    expect(document['x-runtime-contract-status']).toMatchObject({
      authentication: expect.stringContaining('BearerAuth is implemented for formal stage-attempt runtime'),
      idempotency: expect.stringContaining('formal stage-attempt start and submit use Idempotency-Key'),
      revision: expect.stringContaining('not currently required'),
    })
    expect(document['x-runtime-contract-status']?.idempotency).toContain('IDEMPOTENCY_REPLAY is not emitted')
    expect(document.components.parameters.StudentId).toMatchObject({ deprecated: true })
  })
})
