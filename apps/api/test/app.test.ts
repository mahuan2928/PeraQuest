import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { MemoryStudentRepository } from '../src/repository.js'

describe('identity, consent, and capabilities slice', () => {
  const apps: ReturnType<typeof buildApp>[] = []

  beforeEach(() => { vi.stubEnv('ALLOW_LEGACY_TEST_HEADERS', 'true') })

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

  it('returns strict CORS headers for the configured origin and handles preflight', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://dev.example.test')
    const app = buildApp()
    apps.push(app)

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/students/onboarding',
      headers: { origin: 'https://dev.example.test', 'access-control-request-method': 'POST' },
    })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('https://dev.example.test')
    expect(preflight.headers['access-control-allow-methods']).toContain('POST')

    const denied = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://evil.example.test' } })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toEqual({ code: 'CORS_ORIGIN_DENIED' })
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

  it('rejects a guardian impersonating another linked guardian or student', async () => {
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'minor-a', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId: 'guardian-a' })
    await repository.create({ id: 'minor-b', birthMonth: '2012-05', isMinor: true, guardianLinkStatus: 'verified', guardianId: 'guardian-b' })
    const app = buildApp({ repository })
    apps.push(app)

    const wrongGuardian = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { 'x-student-id': 'minor-a', 'x-guardian-id': 'guardian-b' },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(wrongGuardian.statusCode).toBe(403)
    expect(wrongGuardian.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })

    const crossUser = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { 'x-student-id': 'minor-b', 'x-guardian-id': 'guardian-a' },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(crossUser.statusCode).toBe(403)
    expect(crossUser.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })
    await expect(repository.getVoiceConsent('minor-a', 'v1')).resolves.toEqual({ status: 'missing', version: null })
    await expect(repository.getVoiceConsent('minor-b', 'v1')).resolves.toEqual({ status: 'missing', version: null })
  })

  it('returns only allowlisted, redacted details for validation errors', async () => {
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)
    const invalidOnboarding = await app.inject({ method: 'POST', url: '/v1/students/onboarding', payload: { birthMonth: 'not-a-month' } })
    expect(invalidOnboarding.statusCode).toBe(400)
    expect(invalidOnboarding.json()).toEqual({ code: 'INVALID_ONBOARDING', details: { reason: 'invalid', resource: 'request' } })
    const invalidConsent = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': 'adult-1' }, payload: { status: 'granted', version: 'wrong' } })
    expect(invalidConsent.statusCode).toBe(400)
    expect(invalidConsent.json()).toEqual({ code: 'INVALID_CONSENT_VERSION', details: { field: 'version', reason: 'invalid', resource: 'consent' } })
  })

  it('redacts unexpected provider exceptions to the stable internal error contract', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    repository.findById = async () => {
      const error = new Error('provider=acme raw=upstream stack=secret-stack token=secret-token')
      error.stack = 'Error: provider=acme raw=upstream token=secret-token\\n at provider/client.ts:1:1'
      throw error
    }
    const app = buildApp({ repository })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { 'x-student-id': 'adult-1' } })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' })
    expect(response.body).not.toContain('provider=acme')
    expect(response.body).not.toContain('raw=upstream')
    expect(response.body).not.toContain('secret-stack')
    expect(response.body).not.toContain('secret-token')
  })

  it('rejects future birth months during onboarding', async () => {
    const app = buildApp({ now: () => new Date('2026-08-19T00:00:00Z') })
    apps.push(app)
    const response = await app.inject({ method: 'POST', url: '/v1/students/onboarding', payload: { birthMonth: '2026-09', targetExam: 'eiken_grade_3', authProvider: 'email_magic_link', client: { platform: 'pc' } } })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'INVALID_BIRTH_MONTH' })
  })

  it('allows one server-authoritative minor trial and never returns answers before submission', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'minor-1', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    const app = buildApp({ repository, now: () => new Date('2026-08-19T00:00:00Z') })
    apps.push(app)

    const started = await app.inject({ method: 'POST', url: '/v1/trial-attempts', headers: { 'x-student-id': 'minor-1' } })
    expect(started.statusCode).toBe(201)
    const startBody = started.json()
    expect(startBody).toMatchObject({ questionCount: 12, progressPersisted: false, question: { id: 'q1' } })
    expect(startBody.question).not.toHaveProperty('answer')
    expect(startBody.question).not.toHaveProperty('explanation')

    let score = 0
    let question = startBody.question
    for (let index = 0; index < 12; index += 1) {
      const answer = await app.inject({ method: 'POST', url: `/v1/trial-attempts/${startBody.attemptId}/answers`, headers: { 'x-student-id': 'minor-1' }, payload: { questionId: question.id, answer: question.choices[0] } })
      expect(answer.statusCode).toBe(200)
      const body = answer.json()
      expect(body.progressPersisted).toBe(false)
      if (body.correct) score += 1
      if (index < 11) {
        expect(body.score).toBeNull()
        expect(body.nextQuestion).not.toHaveProperty('answer')
        question = body.nextQuestion
      } else {
        expect(body).toMatchObject({ completed: true, nextQuestion: null, score })
      }
    }

    const replay = await app.inject({ method: 'POST', url: '/v1/trial-attempts', headers: { 'x-student-id': 'minor-1' } })
    expect(replay.statusCode).toBe(409)
    expect(replay.json()).toEqual({ code: 'TRIAL_ALREADY_REDEEMED' })
  })

  it('atomically permits only one concurrent trial start', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'minor-1', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)
    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/trial-attempts', headers: { 'x-student-id': 'minor-1' } }),
      app.inject({ method: 'POST', url: '/v1/trial-attempts', headers: { 'x-student-id': 'minor-1' } }),
    ])
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409])
  })

  it('rejects trial answers that are replayed or submitted out of sequence', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'minor-1', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    const app = buildApp({ repository })
    apps.push(app)
    const started = await app.inject({ method: 'POST', url: '/v1/trial-attempts', headers: { 'x-student-id': 'minor-1' } })
    const { attemptId } = started.json()
    const outOfSequence = await app.inject({ method: 'POST', url: `/v1/trial-attempts/${attemptId}/answers`, headers: { 'x-student-id': 'minor-1' }, payload: { questionId: 'q2', answer: 'library' } })
    expect(outOfSequence.statusCode).toBe(409)
    const accepted = await app.inject({ method: 'POST', url: `/v1/trial-attempts/${attemptId}/answers`, headers: { 'x-student-id': 'minor-1' }, payload: { questionId: 'q1', answer: 'play' } })
    expect(accepted.statusCode).toBe(200)
    const replay = await app.inject({ method: 'POST', url: `/v1/trial-attempts/${attemptId}/answers`, headers: { 'x-student-id': 'minor-1' }, payload: { questionId: 'q1', answer: 'play' } })
    expect(replay.statusCode).toBe(409)
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
