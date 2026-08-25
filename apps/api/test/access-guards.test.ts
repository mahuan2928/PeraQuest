import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { MemoryStudentRepository } from '../src/repository.js'

const platforms = ['ios', 'android', 'pc'] as const

describe('P0 access guards', () => {
  const apps: ReturnType<typeof buildApp>[] = []

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(apps.map((app) => app.close()))
    apps.length = 0
  })

  it.each(platforms)('keeps a minor behind the guardian gate on %s', async (platform) => {
    const app = buildApp({ now: () => new Date('2026-08-19T00:00:00Z') })
    apps.push(app)

    const onboarding = await app.inject({
      method: 'POST',
      url: '/v1/students/onboarding',
      payload: {
        birthMonth: '2012-04',
        targetExam: 'eiken_grade_3',
        authProvider: 'email_magic_link',
        client: { platform },
      },
    })

    expect(onboarding.statusCode).toBe(201)
    expect(onboarding.json()).toMatchObject({
      isMinor: true,
      guardianLinkStatus: 'pending',
      onboardingStatus: 'pending_guardian',
    })

    const capabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: {
        'x-student-id': onboarding.json().studentId,
        'x-client-platform': platform,
      },
    })

    expect(capabilities.statusCode).toBe(200)
    expect(capabilities.json()).toMatchObject({
      platform,
      guardianLinkStatus: 'pending',
      canLearn: false,
      canUploadVoice: false,
      voiceUploadMode: 'disabled',
      canPurchase: false,
    })
  })

  it('prevents an unverified minor from granting voice consent', async () => {
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({
      id: 'minor-pending',
      birthMonth: '2012-04',
      isMinor: true,
      guardianLinkStatus: 'pending',
      guardianId: null,
    })
    const app = buildApp({ repository })
    apps.push(app)

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { 'x-student-id': 'minor-pending' },
      payload: { status: 'granted', version: 'v1' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'GUARDIAN_VERIFICATION_REQUIRED' })
  })

  it.each(['missing', 'denied', 'withdrawn'] as const)(
    'blocks voice upload when current consent is %s',
    async (consentState) => {
      vi.stubEnv('VOICE_FEATURE_PUBLIC_ENABLED', 'true')
      vi.stubEnv('AI_VENDOR_APPROVED', 'true')
      vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
      const repository = new MemoryStudentRepository()
      await repository.create({
        id: 'student-voice-guard',
        birthMonth: '2000-01',
        isMinor: false,
        guardianLinkStatus: 'not_required',
      guardianId: null,
      })
      if (consentState !== 'missing') {
        await repository.setVoiceConsent('student-voice-guard', null, consentState, 'v1')
      }
      const app = buildApp({ repository })
      apps.push(app)

      const capabilities = await app.inject({
        method: 'GET',
        url: '/v1/me/capabilities',
        headers: { 'x-student-id': 'student-voice-guard', 'x-client-platform': 'pc' },
      })
      expect(capabilities.statusCode).toBe(200)
      expect(capabilities.json()).toMatchObject({
        voiceConsentStatus: consentState,
        canUploadVoice: false,
        voiceUploadMode: 'disabled',
      })

      const ticket = await app.inject({
        method: 'POST',
        url: '/v1/me/voice-upload-ticket',
        headers: { 'x-student-id': 'student-voice-guard' },
      })
      expect(ticket.statusCode).toBe(403)
      expect(ticket.json()).toEqual({ code: 'VOICE_CONSENT_REQUIRED' })
    },
  )

  it.each(platforms)('never grants direct purchase capability to a student on %s', async (platform) => {
    const repository = new MemoryStudentRepository()
    await repository.create({
      id: 'student-no-purchase',
      birthMonth: '2000-01',
      isMinor: false,
      guardianLinkStatus: 'not_required',
      guardianId: null,
    })
    const app = buildApp({ repository })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: {
        'x-student-id': 'student-no-purchase',
        'x-client-platform': platform,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ platform, canPurchase: false })
    expect(response.json().paymentChannels).not.toHaveLength(0)
  })
})
