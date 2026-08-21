import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { MemoryStudentRepository } from '../src/repository.js'

const createMinor = async (repository: MemoryStudentRepository, id: string, guardianId: string | null = null) => {
  await repository.create({
    id,
    birthMonth: '2012-04',
    isMinor: true,
    guardianLinkStatus: guardianId ? 'verified' : 'pending',
    guardianId,
  })
}

describe('P0 security regressions', () => {
  const apps: ReturnType<typeof buildApp>[] = []

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(apps.map((app) => app.close()))
    apps.length = 0
  })

  it('does not let a forged student header access another student or their trial', async () => {
    const repository = new MemoryStudentRepository()
    await createMinor(repository, 'student-a')
    await createMinor(repository, 'student-b')
    const app = buildApp({ repository })
    apps.push(app)

    const started = await app.inject({
      method: 'POST',
      url: '/v1/trial-attempts',
      headers: { 'x-student-id': 'student-a' },
    })
    expect(started.statusCode).toBe(201)

    const forgedCapabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { 'x-student-id': 'student-a/student-b', 'x-client-platform': 'pc' },
    })
    expect(forgedCapabilities.statusCode).toBe(404)
    expect(forgedCapabilities.json()).toEqual({ code: 'STUDENT_NOT_FOUND' })

    const crossUserAnswer = await app.inject({
      method: 'POST',
      url: `/v1/trial-attempts/${started.json().attemptId}/answers`,
      headers: { 'x-student-id': 'student-b' },
      payload: { questionId: 'q1', answer: 'play' },
    })
    expect(crossUserAnswer.statusCode).toBe(404)
    expect(crossUserAnswer.json()).toEqual({ code: 'TRIAL_ATTEMPT_NOT_FOUND' })
  })

  it('does not let a guardian impersonate the linked guardian or cross-user consent', async () => {
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    vi.stubEnv('VOICE_FEATURE_PUBLIC_ENABLED', 'true')
    vi.stubEnv('AI_VENDOR_APPROVED', 'true')
    const repository = new MemoryStudentRepository()
    await createMinor(repository, 'student-a', 'guardian-a')
    await createMinor(repository, 'student-b', 'guardian-b')
    const app = buildApp({ repository })
    apps.push(app)

    const impersonation = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { 'x-student-id': 'student-a', 'x-guardian-id': 'guardian-b' },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(impersonation.statusCode).toBe(403)
    expect(impersonation.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })

    const legitimate = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { 'x-student-id': 'student-a', 'x-guardian-id': 'guardian-a' },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(legitimate.statusCode).toBe(200)

    const otherStudentCapabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { 'x-student-id': 'student-b', 'x-client-platform': 'pc' },
    })
    expect(otherStudentCapabilities.statusCode).toBe(200)
    expect(otherStudentCapabilities.json()).toMatchObject({ voiceConsentStatus: 'missing', canUploadVoice: false })
  })

  it('atomically rejects duplicate concurrent answers for one trial question', async () => {
    const repository = new MemoryStudentRepository()
    await createMinor(repository, 'student-a')
    const app = buildApp({ repository })
    apps.push(app)
    const started = await app.inject({ method: 'POST', url: '/v1/trial-attempts', headers: { 'x-student-id': 'student-a' } })

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: `/v1/trial-attempts/${started.json().attemptId}/answers`, headers: { 'x-student-id': 'student-a' }, payload: { questionId: 'q1', answer: 'play' } }),
      app.inject({ method: 'POST', url: `/v1/trial-attempts/${started.json().attemptId}/answers`, headers: { 'x-student-id': 'student-a' }, payload: { questionId: 'q1', answer: 'play' } }),
    ])

    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409])
    expect(['TRIAL_ANSWER_ALREADY_SUBMITTED', 'TRIAL_ANSWER_OUT_OF_SEQUENCE']).toContain(responses.find(({ statusCode }) => statusCode === 409)?.json().code)
  })

  it.todo('BLOCKED: assert consent_records.guardian_id equals the authenticated linked guardian_id after consent grant; StudentRepository.setVoiceConsent currently has no guardian_id parameter and the API does not persist it')
})
