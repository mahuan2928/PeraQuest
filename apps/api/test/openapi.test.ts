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
      '/api/v1/me/daily-plan',
      '/api/v1/me/daily-sessions',
      '/api/v1/me/daily-sessions/{sessionId}/answers',
      '/api/v1/me/game-state',
      '/api/v1/stage-attempts/{stageAttemptId}',
      '/api/v1/stage-attempts/{stageAttemptId}/result',
      '/api/v1/stage-attempts/{stageAttemptId}/submit',
      '/api/v1/stage-exams/{stageExamId}/attempts',
      '/api/v1/student-knowledge',
      '/health',
      '/v1/demo/session',
      '/v1/guardian-links/verification',
      '/v1/guardian-links/{studentId}/consents/voice-processing',
      '/v1/guardian-links/{studentId}/learning-summary',
      '/v1/guardian-links/{studentId}/student-knowledge',
      '/v1/me/capabilities',
      '/v1/me/consents/voice-processing',
      '/v1/me/devices/current',
      '/v1/me/devices/current/push-disabled',
      '/v1/me/guardian-link',
      '/v1/me/guardian-link/invitations',
      '/v1/me/voice-upload-ticket',
      '/v1/payments/web-checkout/webhook',
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
    expect(document.components.schemas).toHaveProperty('CurrentDeviceRegistrationRequest')
    expect(document.components.schemas).toHaveProperty('CurrentDeviceRegistrationResponse')
    expect(document.components.schemas).toHaveProperty('CurrentDevicePushDisableRequest')
    expect(document.components.schemas).toHaveProperty('CurrentDevicePushDisableResponse')
    expect(document.components.schemas.CurrentDeviceRegistrationRequest?.properties).not.toHaveProperty('pushToken')
    expect(document.components.schemas.CurrentDevicePushDisableRequest?.properties).not.toHaveProperty('pushToken')
    expect(document.components.schemas).toHaveProperty('DemoSessionRequest')
    expect(document.components.schemas).toHaveProperty('DemoSessionResponse')
    expect(document.components.schemas).toHaveProperty('GuardianInvitationResponse')
    expect(document.components.schemas).toHaveProperty('GuardianLinkVerificationRequest')
    expect(document.components.schemas).toHaveProperty('GuardianLinkVerificationResponse')
    expect(document.components.schemas).toHaveProperty('GuardianVoiceConsentWriteRequest')
    expect(document.components.schemas).toHaveProperty('GuardianVoiceConsentWriteResponse')
    expect(document.components.schemas).toHaveProperty('VoiceUploadTicketRequest')
    expect(document.components.schemas).toHaveProperty('VoiceUploadTicketResponse')
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
    expect(document.components.schemas).toHaveProperty('GameRewardGrant')
    expect(document.components.schemas).toHaveProperty('StudentGameStateResponse')
    expect(document.components.schemas).toHaveProperty('GuardianLearningSummaryItem')
    expect(document.components.schemas).toHaveProperty('GuardianLearningSummaryResponse')
    expect(document.components.schemas).toHaveProperty('StudentKnowledgeProjection')
    expect(document.components.schemas).toHaveProperty('StudentKnowledgeProjectionListResponse')
    expect(document.components.schemas).toHaveProperty('WebCheckoutWebhookRequest')
    expect(document.components.schemas).toHaveProperty('WebCheckoutWebhookResponse')
    expect(document.components.schemas.StudentKnowledgeProjection?.properties).not.toHaveProperty('stabilityDays')
    expect(document.components.schemas.StudentKnowledgeProjection?.properties).not.toHaveProperty('attemptCount')
    expect(document.components.schemas.SafeErrorDetails?.properties).toMatchObject({ resource: { enum: expect.arrayContaining(['payment_webhook']) } })
    expect((document.components.schemas.SubmitStageAttemptRequest?.properties as { answers?: { minItems?: number; maxItems?: number } }).answers).toMatchObject({ minItems: 1, maxItems: 200 })
    expect(document.components.schemas.PublicStageExamItem?.properties).not.toHaveProperty('correctOptionId')
    expect(document.components.schemas).not.toHaveProperty('MasteryUpdate')
    expect(document.components.schemas).not.toHaveProperty('KnowledgeEvidence')
    expect(document.paths).not.toHaveProperty('/v1/me/stage-exams/{examVersionId}/attempts')
    expect(document.paths).not.toHaveProperty('/v1/me/stage-attempts/{attemptId}/submit')
    expect(document.components.securitySchemes).toHaveProperty('BearerAuth')
    expect(document.components.securitySchemes).toHaveProperty('LegacyGuardianHeader')
    const writeOperations = Object.values(document.paths)
      .flatMap((item) => Object.entries(item)
        .filter(([method]) => ['post', 'put', 'patch', 'delete'].includes(method))
        .map(([, operation]) => operation as { operationId?: string; parameters?: Array<{ $ref?: string }>; security?: unknown }))
      .filter((operation) => ![
        'createDemoSession',
        'processWebCheckoutWebhook',
        // 毎日ループの書き込みは一意キーで冪等です。
        // startDailySession は UNIQUE(student_id, session_date)、
        // submitDailyAnswer は UNIQUE(session_id, content_item_id) で、
        // 再送しても同じセッションが返り、生命値は二度減りません。
        'startDailySession',
        'submitDailyAnswer',
      ].includes(operation.operationId ?? ''))
    expect(writeOperations.every((operation) => operation.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey' || parameter.$ref === '#/components/parameters/FormalIdempotencyKey'))).toBe(true)
    const createDemoSessionOperation = document.paths['/v1/demo/session']?.post
    const startStageAttemptOperation = document.paths['/api/v1/stage-exams/{stageExamId}/attempts']?.post
    const putVoiceConsentOperation = document.paths['/v1/me/consents/voice-processing']?.put
    const putCurrentDeviceOperation = document.paths['/v1/me/devices/current']?.put
    const putCurrentDevicePushDisabledOperation = document.paths['/v1/me/devices/current/push-disabled']?.put
    const postGuardianInvitationOperation = document.paths['/v1/me/guardian-link/invitations']?.post
    const postVoiceUploadTicketOperation = document.paths['/v1/me/voice-upload-ticket']?.post
    const putGuardianVerificationOperation = document.paths['/v1/guardian-links/verification']?.put
    const putGuardianVoiceConsentOperation = document.paths['/v1/guardian-links/{studentId}/consents/voice-processing']?.put
    const getGuardianStudentKnowledgeOperation = document.paths['/v1/guardian-links/{studentId}/student-knowledge']?.get
    const getGuardianLearningSummaryOperation = document.paths['/v1/guardian-links/{studentId}/learning-summary']?.get
    const processWebCheckoutWebhookOperation = document.paths['/v1/payments/web-checkout/webhook']?.post
    const getStageAttemptOperation = document.paths['/api/v1/stage-attempts/{stageAttemptId}']?.get
    const submitStageAttemptOperation = document.paths['/api/v1/stage-attempts/{stageAttemptId}/submit']?.post
    const getStageAttemptResultOperation = document.paths['/api/v1/stage-attempts/{stageAttemptId}/result']?.get
    const getStudentGameStateOperation = document.paths['/api/v1/me/game-state']?.get
    const listStudentKnowledgeOperation = document.paths['/api/v1/student-knowledge']?.get
    expect(createDemoSessionOperation).toBeDefined()
    expect(startStageAttemptOperation).toBeDefined()
    expect(putVoiceConsentOperation).toBeDefined()
    expect(putCurrentDeviceOperation).toBeDefined()
    expect(putCurrentDevicePushDisabledOperation).toBeDefined()
    expect(postGuardianInvitationOperation).toBeDefined()
    expect(postVoiceUploadTicketOperation).toBeDefined()
    expect(putGuardianVerificationOperation).toBeDefined()
    expect(putGuardianVoiceConsentOperation).toBeDefined()
    expect(getGuardianStudentKnowledgeOperation).toBeDefined()
    expect(getGuardianLearningSummaryOperation).toBeDefined()
    expect(processWebCheckoutWebhookOperation).toBeDefined()
    expect(getStageAttemptOperation).toBeDefined()
    expect(submitStageAttemptOperation).toBeDefined()
    expect(getStageAttemptResultOperation).toBeDefined()
    expect(getStudentGameStateOperation).toBeDefined()
    expect(listStudentKnowledgeOperation).toBeDefined()
    expect(createDemoSessionOperation!.security).toEqual([])
    expect(putVoiceConsentOperation!.security).toContainEqual({ BearerAuth: [] })
    expect(putCurrentDeviceOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(putCurrentDevicePushDisabledOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(postGuardianInvitationOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(postVoiceUploadTicketOperation!.security).toContainEqual({ BearerAuth: [] })
    expect(putGuardianVerificationOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(putGuardianVoiceConsentOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(getGuardianStudentKnowledgeOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(getGuardianLearningSummaryOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(processWebCheckoutWebhookOperation!.security).toEqual([{ WebhookSignature: [] }])
    expect(startStageAttemptOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(startStageAttemptOperation!.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/FormalIdempotencyKey')).toBe(true)
    expect(getStageAttemptOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(submitStageAttemptOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(submitStageAttemptOperation!.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/FormalIdempotencyKey')).toBe(true)
    expect(getStageAttemptResultOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(getStudentGameStateOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(listStudentKnowledgeOperation!.security).toEqual([{ BearerAuth: [] }])
    expect(document.components.securitySchemes).toHaveProperty('WebhookSignature')
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
