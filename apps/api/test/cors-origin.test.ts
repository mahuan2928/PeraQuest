import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { MemoryStudentRepository } from '../src/repository.js'
import { loadConfig } from '../src/config.js'

describe('Origin enforcement', () => {
  const apps: ReturnType<typeof buildApp>[] = []

  beforeEach(() => { vi.stubEnv('ALLOW_LEGACY_TEST_HEADERS', 'true') })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(apps.map((app) => app.close()))
    apps.length = 0
  })

  it('rejects a non-OPTIONS request carrying an Origin outside the allowlist', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://dev.example.test')
    const app = buildApp()
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/students/onboarding',
      headers: { origin: 'https://evil.example.test' },
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'CORS_ORIGIN_DENIED' })
  })

  it('keeps normal server authentication for requests without Origin', async () => {
    const repository = new MemoryStudentRepository()
    const app = buildApp({ repository })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link' })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ code: 'AUTH_REQUIRED' })
  })

  it('rejects a malicious Origin on an authenticated GET before endpoint logic', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://dev.example.test')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { origin: 'https://evil.example.test', 'x-student-id': 'adult-1' } })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'CORS_ORIGIN_DENIED' })
  })

  it('allows an authenticated request without Origin to reach endpoint logic', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { 'x-student-id': 'adult-1' } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'not_required' })
  })


})

describe('legacy header advertisement', () => {
  it('advertises the legacy headers only while they are accepted', async () => {
    const withLegacy = buildApp({ config: loadConfig({ NODE_ENV: 'test', ALLOW_LEGACY_TEST_HEADERS: 'true' }) })
    const allowed = await withLegacy.inject({
      method: 'OPTIONS',
      url: '/v1/me/capabilities',
      headers: { origin: 'http://localhost:5173' },
    })
    expect(allowed.headers['access-control-allow-headers']).toContain('x-student-id')
    await withLegacy.close()

    // 本番では ALLOW_LEGACY_TEST_HEADERS が強制的に false になります。
    const production = buildApp({
      config: loadConfig({
        NODE_ENV: 'production', ALLOW_LEGACY_TEST_HEADERS: 'true',
        AUTH_ISSUER: 'https://issuer.example.test', AUTH_AUDIENCE: 'peraquest-api',
        AUTH_JWKS_URL: 'https://issuer.example.test/.well-known/jwks.json',
        AUTH_PROVIDER: 'email_magic_link', CORS_ORIGIN: 'https://app.example.test',
      }),
    })
    const denied = await production.inject({
      method: 'OPTIONS',
      url: '/v1/me/capabilities',
      headers: { origin: 'https://app.example.test' },
    })
    expect(denied.headers['access-control-allow-headers']).not.toContain('x-student-id')
    await production.close()
  })
})

