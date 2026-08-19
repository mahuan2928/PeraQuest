import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { MemoryStudentRepository } from '../src/repository.js'

describe('identity, consent, and capabilities slice', () => {
  const apps: ReturnType<typeof buildApp>[] = []

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(apps.map((app) => app.close()))
    apps.length = 0
  })

  it('reports health', async () => {
    const app = buildApp()
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('onboards a minor into pending guardian state', async () => {
    const app = buildApp({ now: () => new Date('2026-08-19T00:00:00Z') })
    apps.push(app)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/students/onboarding',
      payload: {
        birthMonth: '2012-04',
        targetExam: 'eiken_grade_3',
        authProvider: 'apple',
        client: { platform: 'ios', deviceId: 'device-1', appVersion: '1.0.0', osVersion: '18' },
      },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ isMinor: true, guardianLinkStatus: 'pending', onboardingStatus: 'pending_guardian' })
  })

  it.each([
    ['ios', ['apple_app_store'], ['ios_push', 'line'], ['app_deep_link', 'web_https']],
    ['android', ['google_play'], ['android_push', 'line'], ['app_deep_link', 'web_https']],
    ['pc', ['web_checkout'], ['web_push', 'line'], ['web_https']],
  ] as const)('returns %s-specific channels without changing account capabilities', async (platform, payments, notifications, lineTargets) => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: { 'x-student-id': 'adult-1', 'x-client-platform': platform } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ platform, paymentChannels: payments, notificationChannels: notifications, lineReturnTargets: lineTargets, canUploadVoice: false })
  })

  it('rejects capabilities requests without an explicit client platform', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: { 'x-student-id': 'adult-1' } })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'INVALID_CLIENT_PLATFORM' })
  })

  it('prevents a verified minor from granting voice consent without the linked guardian identity', async () => {
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'minor-1', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId: 'guardian-1' })
    const app = buildApp({ repository })
    apps.push(app)
    const denied = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': 'minor-1' }, payload: { status: 'granted', version: 'v1' } })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })
    const granted = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': 'minor-1', 'x-guardian-id': 'guardian-1' }, payload: { status: 'granted', version: 'v1' } })
    expect(granted.statusCode).toBe(200)
  })

  it('rejects future birth months during onboarding', async () => {
    const app = buildApp({ now: () => new Date('2026-08-19T00:00:00Z') })
    apps.push(app)
    const response = await app.inject({ method: 'POST', url: '/v1/students/onboarding', payload: { birthMonth: '2026-09', targetExam: 'eiken_grade_3', authProvider: 'email_magic_link', client: { platform: 'pc' } } })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'INVALID_BIRTH_MONTH' })
  })

  it('serves exactly one non-persistent trial through real endpoints', async () => {
    const app = buildApp({ now: () => new Date('2026-08-19T00:00:00Z') })
    apps.push(app)
    const onboarding = await app.inject({
      method: 'POST', url: '/v1/students/onboarding',
      payload: { birthMonth: '2012-04', targetExam: 'eiken_grade_3', authProvider: 'email_magic_link', client: { platform: 'pc' } },
    })
    const studentId = onboarding.json<{ studentId: string }>().studentId
    const headers = { 'x-student-id': studentId }
    const created = await app.inject({ method: 'POST', url: '/v1/me/trial-sessions', headers })
    expect(created.statusCode).toBe(200)
    const session = created.json<{ sessionId: string; questions: Array<{ id: string; choices: string[]; answer?: string }> }>()
    expect(session.questions).toHaveLength(12)
    expect(session.questions[0]).not.toHaveProperty('answer')

    for (const question of session.questions) {
      const answer = await app.inject({
        method: 'POST', url: `/v1/me/trial-sessions/${session.sessionId}/answers`, headers,
        payload: { questionId: question.id, answer: question.choices[0] },
      })
      expect(answer.statusCode).toBe(200)
      expect(answer.json()).toHaveProperty('explanation')
    }

    const completed = await app.inject({ method: 'POST', url: `/v1/me/trial-sessions/${session.sessionId}/complete`, headers })
    expect(completed.statusCode).toBe(200)
    expect(completed.json()).toMatchObject({ total: 12, durableProgressWritten: false })
    const repeated = await app.inject({ method: 'POST', url: '/v1/me/trial-sessions', headers })
    expect(repeated.statusCode).toBe(409)
    expect(repeated.json()).toEqual({ code: 'TRIAL_ALREADY_REDEEMED' })
  })

  it('keeps trial unavailable when guardian status is not pending', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)
    const response = await app.inject({ method: 'POST', url: '/v1/me/trial-sessions', headers: { 'x-student-id': 'adult-1' } })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'TRIAL_NOT_AVAILABLE' })
  })

  it('keeps voice upload blocked when deployment flags are on but consent is absent', async () => {
    vi.stubEnv('VOICE_FEATURE_PUBLIC_ENABLED', 'true')
    vi.stubEnv('AI_VENDOR_APPROVED', 'true')
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)
    const response = await app.inject({ method: 'POST', url: '/v1/me/voice-upload-ticket', headers: { 'x-student-id': 'adult-1' } })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'VOICE_CONSENT_REQUIRED' })
  })

  it('enables signed voice mode only after current consent passes', async () => {
    vi.stubEnv('VOICE_FEATURE_PUBLIC_ENABLED', 'true')
    vi.stubEnv('AI_VENDOR_APPROVED', 'true')
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)
    const consent = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': 'adult-1' }, payload: { status: 'granted', version: 'v1' } })
    expect(consent.statusCode).toBe(200)
    const response = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: { 'x-student-id': 'adult-1', 'x-client-platform': 'pc' } })
    expect(response.json()).toMatchObject({ canUploadVoice: true, voiceUploadMode: 'signed_upload', voiceConsentStatus: 'granted' })
  })
})
