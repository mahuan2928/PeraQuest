import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface OpenApiDocument {
  openapi: string
  paths: Record<string, Record<string, { operationId?: string }>>
  components: { parameters: Record<string, unknown>; schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> }
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
    expect(document.components.parameters.IdempotencyKey).toBeDefined()
    expect(document.components.parameters.IfMatchRevision).toBeDefined()
    expect(document.components.schemas).toHaveProperty('AuthActor')
    expect(document.components.schemas).toHaveProperty('GuardianLinkProjection')
    expect(document.components.schemas).toHaveProperty('ConsentProjection')
    expect(document.components.schemas).toHaveProperty('ErrorResponse')
    expect(document.components.securitySchemes).toHaveProperty('BearerAuth')
    expect(document.components.parameters.StudentId).toMatchObject({ deprecated: true })
  })
})
