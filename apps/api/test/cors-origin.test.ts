import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { MemoryStudentRepository } from '../src/repository.js'

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
