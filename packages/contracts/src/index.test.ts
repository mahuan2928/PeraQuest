import { describe, expect, it } from 'vitest'
import { authMethods, sanitizeErrorDetails, stableErrorCodes, userRoles } from './index'

describe('shared security contracts', () => {
  it('keeps actor enums explicit and stable', () => {
    expect(userRoles).toEqual(['student', 'guardian', 'admin', 'service'])
    expect(authMethods).toContain('bearer')
    expect(authMethods).toContain('legacy_student_header')
  })

  it('drops non-whitelisted error detail fields', () => {
    expect(sanitizeErrorDetails({ field: 'version', reason: 'invalid', secret: 'token' })).toEqual({ field: 'version', reason: 'invalid' })
    expect(sanitizeErrorDetails({ message: 'raw provider error' })).toBeUndefined()
  })

  it('exposes a complete stable error-code allowlist', () => {
    expect(new Set(stableErrorCodes).size).toBe(stableErrorCodes.length)
    expect(stableErrorCodes).toEqual(expect.arrayContaining([
      'AUTH_REQUIRED', 'GUARDIAN_AUTH_REQUIRED', 'VOICE_CONSENT_REQUIRED',
      'IDEMPOTENCY_REPLAY', 'REVISION_CONFLICT', 'INTERNAL_ERROR',
    ]))
  })
})
