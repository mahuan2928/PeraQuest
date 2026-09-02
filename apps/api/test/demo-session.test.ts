import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { MemoryStudentRepository } from '../src/repository.js'

const demoConfig = loadConfig({
  NODE_ENV: 'test',
  AUTH_PROVIDER: 'email_magic_link',
  AUTH_ISSUER: 'https://issuer.demo.test',
  AUTH_AUDIENCE: 'peraquest-api',
  AUTH_JWKS_URL: 'https://issuer.demo.test/.well-known/jwks.json',
  AUTH_CLOCK_SKEW_SECONDS: '0',
  CONSENT_VERSION_REQUIRED: 'v1',
  DEMO_API_ENABLED: 'true',
  DEMO_SESSION_SECRET: 'demo-session-secret-for-tests',
  VOICE_FEATURE_PUBLIC_ENABLED: 'true',
  AI_VENDOR_APPROVED: 'true',
  VOICE_UPLOAD_BUCKET: 'peraquest-demo-voice',
  VOICE_UPLOAD_REGION: 'ap-northeast-1',
  VOICE_UPLOAD_ENDPOINT: 'https://storage.demo.test',
  VOICE_UPLOAD_ACCESS_KEY_ID: 'DEMO_ACCESS_KEY',
  VOICE_UPLOAD_SECRET_ACCESS_KEY: 'demo-secret-only-used-for-local-signing',
})

describe('live API demo session', () => {
  it('is disabled unless explicitly enabled', async () => {
    const app = buildApp({ repository: new MemoryStudentRepository(), config: loadConfig({ NODE_ENV: 'test' }) })
    const response = await app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })
    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('issues short-lived demo bearer tokens that run the guardian voice flow', async () => {
    const repository = new MemoryStudentRepository()
    const now = new Date('2026-08-30T12:00:00.000Z')
    const app = buildApp({ repository, config: demoConfig, now: () => now })
    const session = await app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })
    expect(session.statusCode).toBe(201)
    const body = session.json<{ studentId: string; studentToken: string; guardianToken: string; expiresAt: string }>()
    expect(body.studentToken).toMatch(/^demo\./)
    expect(body.guardianToken).toMatch(/^demo\./)
    expect(body.expiresAt).toBe('2026-08-30T12:10:00.000Z')

    const before = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { authorization: `Bearer ${body.studentToken}`, 'x-client-platform': 'pc' },
    })
    expect(before.statusCode).toBe(200)
    expect(before.json()).toMatchObject({ voiceUploadMode: 'disabled', guardianLinkStatus: 'pending' })

    const invite = await app.inject({
      method: 'POST',
      url: '/v1/me/guardian-link/invitations',
      headers: { authorization: `Bearer ${body.studentToken}` },
    })
    expect(invite.statusCode).toBe(201)

    const consentBeforeVerification = await app.inject({
      method: 'PUT',
      url: `/v1/guardian-links/${body.studentId}/consents/voice-processing`,
      headers: { authorization: `Bearer ${body.guardianToken}` },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(consentBeforeVerification.statusCode).toBe(403)
    expect(consentBeforeVerification.json()).toEqual({ code: 'GUARDIAN_VERIFICATION_REQUIRED' })

    const verified = await app.inject({
      method: 'PUT',
      url: '/v1/guardian-links/verification',
      headers: { authorization: `Bearer ${body.guardianToken}` },
      payload: { inviteCode: invite.json<{ inviteCode: string }>().inviteCode },
    })
    expect(verified.statusCode).toBe(200)
    expect(verified.json()).toMatchObject({ studentId: body.studentId, status: 'verified' })

    const afterVerification = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { authorization: `Bearer ${body.studentToken}`, 'x-client-platform': 'pc' },
    })
    expect(afterVerification.statusCode).toBe(200)
    expect(afterVerification.json()).toMatchObject({ canLearn: true, canPurchase: true, guardianLinkStatus: 'verified', entitlements: [] })

    const granted = await app.inject({
      method: 'PUT',
      url: `/v1/guardian-links/${body.studentId}/consents/voice-processing`,
      headers: { authorization: `Bearer ${body.guardianToken}` },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(granted.statusCode).toBe(200)
    expect(granted.json()).toMatchObject({ status: 'granted' })

    const ticket = await app.inject({
      method: 'POST',
      url: '/v1/me/voice-upload-ticket',
      headers: { authorization: `Bearer ${body.studentToken}` },
      payload: { contentType: 'audio/webm', contentLengthBytes: 4096, durationSeconds: 30, checksumSha256: 'a'.repeat(64) },
    })
    expect(ticket.statusCode).toBe(200)
    expect(ticket.json()).toMatchObject({ method: 'POST', bucket: 'peraquest-demo-voice' })
    await app.close()
  })

  it('resolves persisted demo identities when a token reaches another API instance', async () => {
    const repository = new MemoryStudentRepository()
    const now = new Date('2026-08-30T12:00:00.000Z')
    const firstInstance = buildApp({ repository, config: demoConfig, now: () => now })
    const session = await firstInstance.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })
    expect(session.statusCode).toBe(201)
    const body = session.json<{ studentToken: string }>()
    await firstInstance.close()

    const secondInstance = buildApp({ repository, config: demoConfig, now: () => now })
    const invite = await secondInstance.inject({
      method: 'POST',
      url: '/v1/me/guardian-link/invitations',
      headers: { authorization: `Bearer ${body.studentToken}` },
    })

    expect(invite.statusCode).toBe(201)
    expect(invite.json()).toMatchObject({ inviteCode: expect.any(String), expiresAt: '2026-08-31T12:00:00.000Z' })
    await secondInstance.close()
  })
})
