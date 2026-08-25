import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface OpenApiDocument {
  openapi: string
  paths: Record<string, Record<string, { operationId?: string; parameters?: Array<{ $ref?: string }>; security?: unknown }>>
  components: { parameters: Record<string, { required?: boolean; description?: string; deprecated?: boolean }>; schemas: Record<string, unknown>; securitySchemes: Record<string, { description?: string }> }
  ['x-runtime-contract-status']?: Record<string, string>
}

describe('OpenAPI document', () => {
  it('is valid JSON and documents every route in the first vertical slice', async () => {
    const document = JSON.parse(await readFile(resolve(process.cwd(), '../../docs/api/openapi.json'), 'utf8')) as OpenApiDocument
    expect(document.openapi).toBe('3.1.0')
    expect(Object.keys(document.paths).sort()).toEqual([
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
    expect(document.components.parameters.IdempotencyKey!).toMatchObject({ required: false })
    expect(document.components.parameters.IdempotencyKey!.description).toContain('planned')
    expect(document.components.parameters.IdempotencyKey!.description).toContain('Not implemented')
    expect(document.components.parameters.LegacyGuardianHeader).toBeDefined()
    expect(document.components.parameters.IfMatchRevision!).toMatchObject({ required: false })
    expect(document.components.parameters.IfMatchRevision!.description).toContain('planned')
    expect(document.components.parameters.IfMatchRevision!.description).toContain('Not implemented')
    expect(document.components.schemas).toHaveProperty('AuthActor')
    expect(document.components.schemas).toHaveProperty('GuardianLinkProjection')
    expect(document.components.schemas).toHaveProperty('ConsentProjection')
    expect(document.components.schemas).toHaveProperty('ErrorResponse')
    expect(document.components.securitySchemes).toHaveProperty('BearerAuth')
    expect(document.components.securitySchemes).toHaveProperty('LegacyGuardianHeader')
    const writeOperations = Object.values(document.paths).flatMap((item) => Object.entries(item).filter(([method]) => ['post', 'put', 'patch', 'delete'].includes(method)).map(([, operation]) => operation as { parameters?: Array<{ $ref?: string }>; security?: unknown }))
    expect(writeOperations.every((operation) => operation.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'))).toBe(true)
    expect(writeOperations.every((operation) => operation.security === undefined)).toBe(true)
    expect(document.components.securitySchemes.BearerAuth).toMatchObject({ description: expect.stringContaining('Not implemented') })
    expect(document['x-runtime-contract-status']).toMatchObject({
      authentication: expect.stringContaining('planned'),
      idempotency: expect.stringContaining('not currently required'),
      revision: expect.stringContaining('not currently required'),
    })
    expect(document.components.parameters.StudentId).toMatchObject({ deprecated: true })
  })
})
