import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuthActor, parseBearerToken, verifyClaims, type TokenVerifier } from '../src/auth.js'
import { MemoryStudentRepository } from '../src/repository.js'

describe('AuthActor adapter', () => {
  afterEach(() => vi.unstubAllEnvs())
  const claims = { iss: 'https://issuer.test', aud: 'peraquest-api', sub: 'provider-sub', iat: 1_700_000_000, exp: 1_700_003_600 }
  const resolver = { resolve: async () => ({ id: 'local-user', role: 'student' as const }) }
  const verifier: TokenVerifier = { verify: async () => claims }

  it('requires a bearer token and rejects malformed tokens', () => {
    expect(() => parseBearerToken(undefined)).toThrowError('AUTH_REQUIRED')
    expect(() => parseBearerToken('Basic abc')).toThrowError('AUTH_INVALID')
  })

  it('validates issuer, audience and expiry', () => {
    const config = { issuer: claims.iss, audience: claims.aud, jwksUrl: 'https://issuer.test/jwks', clockSkewSeconds: 60 }
    expect(() => verifyClaims({ ...claims, iss: 'https://evil.test' }, config, 1_700_000_000_000)).toThrowError('AUTH_INVALID')
    expect(() => verifyClaims({ ...claims, aud: 'other' }, config, 1_700_000_000_000)).toThrowError('AUTH_INVALID')
    expect(() => verifyClaims({ ...claims, exp: 1 }, config, 1_700_000_000_000)).toThrowError('AUTH_INVALID')
  })

  it('maps a valid token to a server-derived actor and rejects disabled users', async () => {
    const config = { issuer: claims.iss, audience: claims.aud, jwksUrl: 'https://issuer.test/jwks', clockSkewSeconds: 60 }
    await expect(createAuthActor('valid', config, verifier, resolver, () => 1_700_000_000_000)).resolves.toEqual({ id: 'local-user', role: 'student', method: 'bearer' })
    await expect(createAuthActor('disabled', config, verifier, { resolve: async () => ({ id: 'local-user', role: 'student', disabledAt: new Date() }) }, () => 1_700_000_000_000)).rejects.toThrowError('AUTH_INVALID')
  })

  it('fails closed in production and allows explicit legacy adapter only in development', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_LEGACY_TEST_HEADERS', 'true')
    vi.stubEnv('AUTH_ISSUER', 'https://issuer.test')
    vi.stubEnv('AUTH_AUDIENCE', 'peraquest-api')
    vi.stubEnv('AUTH_JWKS_URL', 'https://issuer.test/jwks')
    const production = buildApp({ repository: new MemoryStudentRepository() })
    const denied = await production.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { 'x-student-id': 'local-user' } })
    expect(denied.statusCode).toBe(401)
    await production.close()

    vi.stubEnv('NODE_ENV', 'test')
    const development = buildApp({ repository: new MemoryStudentRepository() })
    const allowed = await development.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { 'x-student-id': 'local-user' } })
    expect(allowed.statusCode).toBe(404)
    await development.close()
  })

  it('leaves the existing Guardian consent policy to the route guard', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ALLOW_LEGACY_TEST_HEADERS', 'true')
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'minor-1', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId: 'guardian-1' })
    const app = buildApp({ repository })

    const missingGuardian = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { 'x-student-id': 'minor-1' },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(missingGuardian.statusCode).toBe(403)
    expect(missingGuardian.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })

    const linkedGuardian = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { 'x-student-id': 'minor-1', 'x-guardian-id': 'guardian-1' },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(linkedGuardian.statusCode).toBe(200)
    await app.close()
  })

  it('does not infer a target student from a bearer guardian actor', async () => {
    vi.stubEnv('AUTH_ISSUER', claims.iss)
    const guardianResolver = { resolve: async () => ({ id: 'guardian-1', role: 'guardian' as const }) }
    const app = buildApp({ tokenVerifier: verifier, authUserResolver: guardianResolver, now: () => new Date(1_700_000_000_000) })
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { authorization: 'Bearer token' },
      payload: { status: 'granted', version: 'v0' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ code: 'AUTH_REQUIRED' })
    await app.close()
  })

  it('rejects bearer and legacy identity mixing', async () => {
    vi.stubEnv('ALLOW_LEGACY_TEST_HEADERS', 'true')
    const app = buildApp({ tokenVerifier: verifier, authUserResolver: resolver })
    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { authorization: 'Bearer token', 'x-student-id': 'other' } })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ code: 'AUTH_INVALID' })
    await app.close()
  })
})
