import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { MemoryStudentRepository } from '../src/repository.js'
import type { TokenVerifier } from '../src/auth.js'

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`
}

const signWebhookPayload = (payload: unknown, secret: string): string => createHmac('sha256', secret).update(stableStringify(payload)).digest('hex')

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

  it('binds a verified provider subject during onboarding so bearer calls resolve to the new student', async () => {
    const now = () => new Date('2026-08-19T00:00:00Z')
    const repository = new MemoryStudentRepository()
    const verifier: TokenVerifier = {
      verify: async () => ({
        iss: 'https://issuer.example.test',
        aud: 'peraquest-api',
        sub: 'subject-new-student',
        iat: 1_787_097_600,
        exp: 1_787_101_200,
      }),
    }
    const app = buildApp({ repository, authUserResolver: repository, tokenVerifier: verifier, now })
    apps.push(app)

    const onboarded = await app.inject({
      method: 'POST',
      url: '/v1/students/onboarding',
      headers: { authorization: 'Bearer provider-token' },
      payload: {
        birthMonth: '2012-04',
        targetExam: 'eiken_grade_3',
        authProvider: 'email_magic_link',
        client: { platform: 'pc' },
      },
    })
    expect(onboarded.statusCode).toBe(201)
    const studentId = onboarded.json().studentId

    const guardianLink = await app.inject({
      method: 'GET',
      url: '/v1/me/guardian-link',
      headers: { authorization: 'Bearer provider-token' },
    })

    expect(guardianLink.statusCode).toBe(200)
    expect(guardianLink.json()).toMatchObject({ status: 'pending' })
    await expect(repository.findById(studentId)).resolves.toMatchObject({ id: studentId })
  })

  it('returns the current student game state only to a formal student bearer', async () => {
    const now = () => new Date('2026-08-19T00:00:00Z')
    const repository = new MemoryStudentRepository()
    const verifier: TokenVerifier = {
      verify: async (token) => ({
        iss: 'https://issuer.example.test',
        aud: 'peraquest-api',
        sub: token,
        iat: 1_787_097_600,
        exp: 1_787_101_200,
      }),
    }
    const authUserResolver = {
      resolve: async (_issuer: string, providerSubject: string) => (
        providerSubject === 'student-game-sub'
          ? { id: '00000000-0000-0000-0000-00000000d101', role: 'student' as const }
          : { id: '00000000-0000-0000-0000-00000000d102', role: 'guardian' as const }
      ),
    }
    await repository.create({ id: '00000000-0000-0000-0000-00000000d101', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    const app = buildApp({ repository, tokenVerifier: verifier, authUserResolver, now })
    apps.push(app)

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/me/game-state',
      headers: { authorization: 'Bearer student-game-sub' },
    })
    const legacyDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/me/game-state',
      headers: { 'x-student-id': '00000000-0000-0000-0000-00000000d101' },
    })
    const guardianDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/me/game-state',
      headers: { authorization: 'Bearer guardian-game-sub' },
    })

    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toMatchObject({
      studentId: '00000000-0000-0000-0000-00000000d101',
      totalXp: 0,
      activityCoins: 0,
      questChapter: 0,
      questStep: 0,
      badges: [],
    })
    expect(legacyDenied.statusCode).toBe(401)
    expect(legacyDenied.json()).toEqual({ code: 'LEGACY_AUTH_NOT_ALLOWED' })
    expect(guardianDenied.statusCode).toBe(403)
    expect(guardianDenied.json()).toEqual({ code: 'AUTH_FORBIDDEN' })
  })

  it('rejects onboarding when the provider subject is already bound', async () => {
    const now = () => new Date('2026-08-19T00:00:00Z')
    const repository = new MemoryStudentRepository()
    const verifier: TokenVerifier = {
      verify: async () => ({
        iss: 'https://issuer.example.test',
        aud: 'peraquest-api',
        sub: 'subject-duplicate',
        iat: 1_787_097_600,
        exp: 1_787_101_200,
      }),
    }
    const app = buildApp({ repository, authUserResolver: repository, tokenVerifier: verifier, now })
    apps.push(app)
    const payload = {
      birthMonth: '2012-04',
      targetExam: 'eiken_grade_3',
      authProvider: 'email_magic_link',
      client: { platform: 'pc' },
    }

    expect((await app.inject({ method: 'POST', url: '/v1/students/onboarding', headers: { authorization: 'Bearer provider-token' }, payload })).statusCode).toBe(201)
    const duplicate = await app.inject({ method: 'POST', url: '/v1/students/onboarding', headers: { authorization: 'Bearer provider-token' }, payload })

    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).toEqual({ code: 'REVISION_CONFLICT' })
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

  it('returns server-side active entitlements in capabilities without changing purchase policy', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    repository.listActiveEntitlements = async (studentId) => studentId === 'adult-1' ? ['exam_grade_3_full', 'premium_lesson_pack'] : []
    const app = buildApp({ repository, now: () => new Date('2026-08-30T00:00:00.000Z') })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: { 'x-student-id': 'adult-1', 'x-client-platform': 'pc' } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      canPurchase: true,
      entitlements: ['exam_grade_3_full', 'premium_lesson_pack'],
      paymentChannels: ['web_checkout'],
    })
  })

  it('processes signed web checkout webhooks idempotently and exposes active entitlements', async () => {
    vi.stubEnv('WEB_CHECKOUT_WEBHOOK_SECRET', 'test-webhook-secret')
    const repository = new MemoryStudentRepository()
    const studentId = '00000000-0000-0000-0000-00000000c001'
    const guardianId = '00000000-0000-0000-0000-00000000c002'
    await repository.create({ id: studentId, birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId })
    const app = buildApp({ repository, now: () => new Date('2026-08-30T00:00:00.000Z') })
    apps.push(app)
    const payload = {
      eventId: 'evt-paid-1',
      eventType: 'subscription.active',
      studentId,
      purchaserGuardianId: guardianId,
      externalSubscriptionId: 'sub-paid-1',
      entitlementCode: 'premium_practice',
      validUntil: '2026-09-30T00:00:00.000Z',
    }

    const webhook = await app.inject({
      method: 'POST',
      url: '/v1/payments/web-checkout/webhook',
      headers: { 'x-peraquest-webhook-signature': signWebhookPayload(payload, 'test-webhook-secret') },
      payload,
    })
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/payments/web-checkout/webhook',
      headers: { 'x-peraquest-webhook-signature': signWebhookPayload(payload, 'test-webhook-secret') },
      payload,
    })
    const capabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { 'x-student-id': studentId, 'x-client-platform': 'pc' },
    })

    expect(webhook.statusCode).toBe(200)
    expect(webhook.json()).toEqual({ received: true, duplicate: false })
    expect(duplicate.statusCode).toBe(200)
    expect(duplicate.json()).toEqual({ received: true, duplicate: true })
    expect(capabilities.json()).toMatchObject({ canPurchase: true, entitlements: ['premium_practice'] })
  })

  it('rejects a reused web checkout event id when the signed payload changes', async () => {
    vi.stubEnv('WEB_CHECKOUT_WEBHOOK_SECRET', 'test-webhook-secret')
    const repository = new MemoryStudentRepository()
    const studentId = '00000000-0000-0000-0000-00000000c061'
    const guardianId = '00000000-0000-0000-0000-00000000c062'
    await repository.create({ id: studentId, birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId })
    const app = buildApp({ repository, now: () => new Date('2026-08-30T00:00:00.000Z') })
    apps.push(app)
    const payload = {
      eventId: 'evt-reused-changed',
      eventType: 'subscription.active',
      studentId,
      purchaserGuardianId: guardianId,
      externalSubscriptionId: 'sub-reused',
      entitlementCode: 'premium_practice',
    }
    const changedPayload = { ...payload, entitlementCode: 'premium_extra' }

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/payments/web-checkout/webhook',
      headers: { 'x-peraquest-webhook-signature': signWebhookPayload(payload, 'test-webhook-secret') },
      payload,
    })
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/payments/web-checkout/webhook',
      headers: { 'x-peraquest-webhook-signature': signWebhookPayload(changedPayload, 'test-webhook-secret') },
      payload: changedPayload,
    })
    const capabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { 'x-student-id': studentId, 'x-client-platform': 'pc' },
    })

    expect(accepted.statusCode).toBe(200)
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json()).toEqual({ code: 'IDEMPOTENCY_KEY_REUSED', details: { resource: 'payment_webhook', reason: 'conflict' } })
    expect(capabilities.json()).toMatchObject({ entitlements: ['premium_practice'] })
  })

  it('rejects unsigned web checkout webhooks before writing entitlements', async () => {
    vi.stubEnv('WEB_CHECKOUT_WEBHOOK_SECRET', 'test-webhook-secret')
    const repository = new MemoryStudentRepository()
    const studentId = '00000000-0000-0000-0000-00000000c011'
    const guardianId = '00000000-0000-0000-0000-00000000c012'
    await repository.create({ id: studentId, birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId })
    const app = buildApp({ repository, now: () => new Date('2026-08-30T00:00:00.000Z') })
    apps.push(app)
    const payload = {
      eventId: 'evt-bad-signature',
      eventType: 'subscription.active',
      studentId,
      purchaserGuardianId: guardianId,
      externalSubscriptionId: 'sub-unpaid',
      entitlementCode: 'premium_practice',
    }

    const webhook = await app.inject({
      method: 'POST',
      url: '/v1/payments/web-checkout/webhook',
      headers: { 'x-peraquest-webhook-signature': '0'.repeat(64) },
      payload,
    })
    const capabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { 'x-student-id': studentId, 'x-client-platform': 'pc' },
    })

    expect(webhook.statusCode).toBe(401)
    expect(webhook.json()).toEqual({ code: 'PAYMENT_WEBHOOK_SIGNATURE_INVALID' })
    expect(capabilities.json()).toMatchObject({ entitlements: [] })
  })

  it('returns a stable service error when the web checkout webhook secret is not configured', async () => {
    const app = buildApp()
    apps.push(app)
    const payload = {
      eventId: 'evt-not-configured',
      eventType: 'subscription.active',
      studentId: '00000000-0000-0000-0000-00000000c021',
      purchaserGuardianId: '00000000-0000-0000-0000-00000000c022',
      externalSubscriptionId: 'sub-not-configured',
      entitlementCode: 'premium_practice',
    }

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payments/web-checkout/webhook',
      headers: { 'x-peraquest-webhook-signature': signWebhookPayload(payload, 'unused-secret') },
      payload,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ code: 'PAYMENT_WEBHOOK_NOT_CONFIGURED' })
  })

  it('rejects unsupported web checkout events before writing entitlements', async () => {
    vi.stubEnv('WEB_CHECKOUT_WEBHOOK_SECRET', 'test-webhook-secret')
    const repository = new MemoryStudentRepository()
    const studentId = '00000000-0000-0000-0000-00000000c031'
    const guardianId = '00000000-0000-0000-0000-00000000c032'
    await repository.create({ id: studentId, birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId })
    const app = buildApp({ repository, now: () => new Date('2026-08-30T00:00:00.000Z') })
    apps.push(app)
    const payload = {
      eventId: 'evt-unsupported',
      eventType: 'invoice.created',
      studentId,
      purchaserGuardianId: guardianId,
      externalSubscriptionId: 'sub-unsupported',
      entitlementCode: 'premium_practice',
    }

    const webhook = await app.inject({
      method: 'POST',
      url: '/v1/payments/web-checkout/webhook',
      headers: { 'x-peraquest-webhook-signature': signWebhookPayload(payload, 'test-webhook-secret') },
      payload,
    })
    const capabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { 'x-student-id': studentId, 'x-client-platform': 'pc' },
    })

    expect(webhook.statusCode).toBe(422)
    expect(webhook.json()).toEqual({ code: 'PAYMENT_WEBHOOK_UNSUPPORTED_EVENT' })
    expect(capabilities.json()).toMatchObject({ entitlements: [] })
  })

  it('rejects web checkout entitlement projection without a verified guardian link', async () => {
    vi.stubEnv('WEB_CHECKOUT_WEBHOOK_SECRET', 'test-webhook-secret')
    const repository = new MemoryStudentRepository()
    const studentId = '00000000-0000-0000-0000-00000000c041'
    await repository.create({ id: studentId, birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    const app = buildApp({ repository, now: () => new Date('2026-08-30T00:00:00.000Z') })
    apps.push(app)
    const payload = {
      eventId: 'evt-guardian-mismatch',
      eventType: 'subscription.active',
      studentId,
      purchaserGuardianId: '00000000-0000-0000-0000-00000000c042',
      externalSubscriptionId: 'sub-guardian-mismatch',
      entitlementCode: 'premium_practice',
    }

    const webhook = await app.inject({
      method: 'POST',
      url: '/v1/payments/web-checkout/webhook',
      headers: { 'x-peraquest-webhook-signature': signWebhookPayload(payload, 'test-webhook-secret') },
      payload,
    })
    const capabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { 'x-student-id': studentId, 'x-client-platform': 'pc' },
    })

    expect(webhook.statusCode).toBe(409)
    expect(webhook.json()).toEqual({ code: 'GUARDIAN_VERIFICATION_REQUIRED' })
    expect(capabilities.json()).toMatchObject({ canPurchase: false, entitlements: [] })
  })

  it('projects active and grace web checkout statuses while hiding expired or revoked entitlements', async () => {
    vi.stubEnv('WEB_CHECKOUT_WEBHOOK_SECRET', 'test-webhook-secret')
    const repository = new MemoryStudentRepository()
    const studentId = '00000000-0000-0000-0000-00000000c051'
    const guardianId = '00000000-0000-0000-0000-00000000c052'
    await repository.create({ id: studentId, birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId })
    const app = buildApp({ repository, now: () => new Date('2026-08-30T00:00:00.000Z') })
    apps.push(app)
    const sendWebhook = async (eventId: string, eventType: string, entitlementCode: string, validUntil: string | null = null) => {
      const payload = {
        eventId,
        eventType,
        studentId,
        purchaserGuardianId: guardianId,
        externalSubscriptionId: `sub-${entitlementCode}`,
        entitlementCode,
        validUntil,
      }
      return app.inject({
        method: 'POST',
        url: '/v1/payments/web-checkout/webhook',
        headers: { 'x-peraquest-webhook-signature': signWebhookPayload(payload, 'test-webhook-secret') },
        payload,
      })
    }

    const active = await sendWebhook('evt-active-status', 'subscription.active', 'premium_practice', '2026-09-30T00:00:00.000Z')
    const grace = await sendWebhook('evt-grace-status', 'subscription.grace_period', 'premium_review', '2026-09-02T00:00:00.000Z')
    const expired = await sendWebhook('evt-expired-status', 'subscription.expired', 'premium_expired', '2026-09-30T00:00:00.000Z')
    const revoked = await sendWebhook('evt-revoked-status', 'subscription.revoked', 'premium_revoked', '2026-09-30T00:00:00.000Z')
    const pastGrace = await sendWebhook('evt-past-grace-status', 'subscription.grace_period', 'premium_past_grace', '2026-08-29T00:00:00.000Z')
    const capabilities = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { 'x-student-id': studentId, 'x-client-platform': 'pc' },
    })

    expect([active.statusCode, grace.statusCode, expired.statusCode, revoked.statusCode, pastGrace.statusCode]).toEqual([200, 200, 200, 200, 200])
    expect(capabilities.json()).toMatchObject({
      canPurchase: true,
      entitlements: ['premium_practice', 'premium_review'],
    })
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

  it('allows only the verified guardian to read a child knowledge summary', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: '00000000-0000-0000-0000-00000000d001', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId: 'guardian-ok' })
    repository.listStudentKnowledgeProjections = async (studentId) => studentId === '00000000-0000-0000-0000-00000000d001'
      ? [{
          studentId,
          knowledgePointRef: 'vocabulary.context',
          rawCorrectTotal: 3,
          rawAttemptTotal: 4,
          masteryScore: 0.72,
          state: 'learning',
          lastOccurredAt: '2026-08-31T00:00:00.000Z',
          dueAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-08-31T00:00:00.000Z',
        }]
      : []
    const verifier: TokenVerifier = {
      verify: async (token) => ({
        iss: 'https://issuer.example.test',
        aud: 'peraquest-api',
        sub: token,
        iat: 1_788_134_400,
        exp: 1_788_138_000,
      }),
    }
    const authUserResolver = {
      resolve: async (_issuer: string, providerSubject: string) => (
        providerSubject === 'guardian-sub'
          ? { id: 'guardian-ok', role: 'guardian' as const }
          : { id: 'guardian-other', role: 'guardian' as const }
      ),
    }
    const app = buildApp({ repository, tokenVerifier: verifier, authUserResolver, now: () => new Date('2026-08-31T00:00:00Z') })
    apps.push(app)

    const allowed = await app.inject({
      method: 'GET',
      url: '/v1/guardian-links/00000000-0000-0000-0000-00000000d001/student-knowledge',
      headers: { authorization: 'Bearer guardian-sub' },
    })
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/guardian-links/00000000-0000-0000-0000-00000000d001/student-knowledge',
      headers: { authorization: 'Bearer guardian-other-sub' },
    })

    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toMatchObject({ items: [{ knowledgePointRef: 'vocabulary.context', masteryScore: 0.72 }] })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })
  })

  it('returns a guardian-readable learning summary for a verified child', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: '00000000-0000-0000-0000-00000000d011', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId: 'guardian-ok' })
    repository.listStudentKnowledgeProjections = async (studentId) => studentId === '00000000-0000-0000-0000-00000000d011'
      ? [
          {
            studentId,
            knowledgePointRef: 'vocabulary.context',
            rawCorrectTotal: 4,
            rawAttemptTotal: 5,
            masteryScore: 0.82,
            state: 'mastered',
            lastOccurredAt: '2026-08-31T00:00:00.000Z',
            dueAt: '2026-09-03T00:00:00.000Z',
            updatedAt: '2026-08-31T00:00:00.000Z',
          },
          {
            studentId,
            knowledgePointRef: 'grammar.comparative',
            rawCorrectTotal: 1,
            rawAttemptTotal: 3,
            masteryScore: 0.42,
            state: 'review',
            lastOccurredAt: '2026-08-31T00:00:00.000Z',
            dueAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-08-31T00:00:00.000Z',
          },
        ]
      : []
    repository.getStudentGameState = async (studentId) => ({
      studentId,
      totalXp: 160,
      activityCoins: 70,
      questChapter: 1,
      questStep: 1,
      badges: ['guardian_shield', 'level_check_challenger'],
      updatedAt: '2026-08-31T00:00:00.000Z',
    })
    const verifier: TokenVerifier = {
      verify: async (token) => ({
        iss: 'https://issuer.example.test',
        aud: 'peraquest-api',
        sub: token,
        iat: 1_788_134_400,
        exp: 1_788_138_000,
      }),
    }
    const authUserResolver = {
      resolve: async (_issuer: string, providerSubject: string) => (
        providerSubject === 'guardian-sub'
          ? { id: 'guardian-ok', role: 'guardian' as const }
          : { id: 'guardian-other', role: 'guardian' as const }
      ),
    }
    const app = buildApp({ repository, tokenVerifier: verifier, authUserResolver, now: () => new Date('2026-08-31T00:00:00Z') })
    apps.push(app)

    const allowed = await app.inject({
      method: 'GET',
      url: '/v1/guardian-links/00000000-0000-0000-0000-00000000d011/learning-summary',
      headers: { authorization: 'Bearer guardian-sub' },
    })
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/guardian-links/00000000-0000-0000-0000-00000000d011/learning-summary',
      headers: { authorization: 'Bearer guardian-other-sub' },
    })

    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toMatchObject({
      overview: {
        averageMasteryPercent: 62,
        masteredItemCount: 1,
        reviewItemCount: 1,
      },
      strengths: [{ label: '文脈から語彙を選ぶ力', masteryPercent: 82 }],
      reviewFocus: [{ label: '比較表現', masteryPercent: 42 }],
      quest: {
        totalXp: 160,
        activityCoins: 70,
        badges: ['guardian_shield', 'level_check_challenger'],
      },
      nextRecommendation: '次回は「比較表現」を短く復習することをおすすめします。',
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })
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

  it('allows one server-authoritative minor trial without durable knowledge-domain side effects', async () => {
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
      expect(body).not.toHaveProperty('knowledgeEvidence')
      expect(body).not.toHaveProperty('remediationTasks')
      expect(body).not.toHaveProperty('unlockState')
      expect(body).not.toHaveProperty('mastery')
      expect(body).not.toHaveProperty('rewards')
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

  it('keeps signed voice upload ticket disabled when storage signing is not configured', async () => {
    vi.stubEnv('VOICE_FEATURE_PUBLIC_ENABLED', 'true')
    vi.stubEnv('AI_VENDOR_APPROVED', 'true')
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const repository = new MemoryStudentRepository()
    await repository.create({ id: 'adult-1', birthMonth: '2000-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
    await repository.setVoiceConsent('adult-1', null, 'granted', 'v1')
    const app = buildApp({ repository })
    apps.push(app)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/voice-upload-ticket',
      headers: { 'x-student-id': 'adult-1' },
      payload: { contentType: 'audio/webm', contentLengthBytes: 1024, durationSeconds: 10, checksumSha256: 'd'.repeat(64) },
    })
    expect(response.statusCode).toBe(501)
    expect(response.json()).toEqual({ code: 'SIGNED_UPLOAD_NOT_CONFIGURED' })
  })
})
