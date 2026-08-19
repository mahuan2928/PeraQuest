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
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ isMinor: true, guardianLinkStatus: 'pending', onboardingStatus: 'pending_guardian' })
  })

  it.each([
    ['ios', ['apple_app_store'], ['ios_push', 'line'], ['app_deep_link', 'web_https']],
    ['android', ['google_play'], ['android_push', 'line'], ['app_deep_link', 'web_https']],
    ['pc', ['web_checkout'], ['web_push', 'line'], ['web_https']],
  ] as const)('returns %s-specific channels without changing account capabilities', async (platform, payments, notifications, lineTargets) => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required' })
    const app = buildApp({ repository })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: { 'x-student-id': 'adult-1', 'x-client-platform': platform } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ platform, paymentChannels: payments, notificationChannels: notifications, lineReturnTargets: lineTargets, canUploadVoice: false })
  })

  it('keeps voice upload blocked when deployment flags are on but consent is absent', async () => {
    vi.stubEnv('VOICE_FEATURE_PUBLIC_ENABLED', 'true')
    vi.stubEnv('AI_VENDOR_APPROVED', 'true')
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required' })
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
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required' })
    const app = buildApp({ repository })
    apps.push(app)
    const consent = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': 'adult-1' }, payload: { status: 'granted', version: 'v1' } })
    expect(consent.statusCode).toBe(200)
    const response = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: { 'x-student-id': 'adult-1', 'x-client-platform': 'pc' } })
    expect(response.json()).toMatchObject({ canUploadVoice: true, voiceUploadMode: 'signed_upload', voiceConsentStatus: 'granted' })
  })
})
