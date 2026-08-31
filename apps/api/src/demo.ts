import { pathToFileURL } from 'node:url'
import type { AuthUserResolver, TokenVerifier } from './auth.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { MemoryStudentRepository } from './repository.js'

const now = new Date('2026-08-30T12:00:00.000Z')
const minorId = '00000000-0000-0000-0000-000000000701'
const guardianId = '00000000-0000-0000-0000-000000000702'
const minorToken = 'demo-minor-sub'
const guardianToken = 'demo-guardian-sub'

type DemoLogger = (message: string) => void

const printStep = (log: DemoLogger, title: string, statusCode: number, body: unknown): void => {
  log(`\n# ${title}`)
  log(`HTTP ${statusCode}`)
  log(JSON.stringify(body, null, 2))
}

export const runApiDemo = async (log: DemoLogger = console.log): Promise<void> => {
  const repository = new MemoryStudentRepository()
  await repository.create({
    id: minorId,
    birthMonth: '2012-04',
    isMinor: true,
    guardianLinkStatus: 'pending',
    guardianId: null,
  })

  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'email_magic_link',
    AUTH_ISSUER: 'https://issuer.demo.test',
    AUTH_AUDIENCE: 'peraquest-api',
    AUTH_JWKS_URL: 'https://issuer.demo.test/.well-known/jwks.json',
    AUTH_CLOCK_SKEW_SECONDS: '0',
    CONSENT_VERSION_REQUIRED: 'v1',
    VOICE_FEATURE_PUBLIC_ENABLED: 'true',
    AI_VENDOR_APPROVED: 'true',
    VOICE_UPLOAD_BUCKET: 'peraquest-demo-voice',
    VOICE_UPLOAD_REGION: 'ap-northeast-1',
    VOICE_UPLOAD_ENDPOINT: 'https://storage.demo.test',
    VOICE_UPLOAD_ACCESS_KEY_ID: 'DEMO_ACCESS_KEY',
    VOICE_UPLOAD_SECRET_ACCESS_KEY: 'demo-secret-only-used-for-local-signing',
    VOICE_UPLOAD_MAX_BYTES: '1048576',
    VOICE_UPLOAD_MAX_DURATION_SECONDS: '120',
    VOICE_UPLOAD_TICKET_TTL_SECONDS: '300',
  })
  const tokenVerifier: TokenVerifier = {
    verify: async (token, authConfig) => {
      const issuedAt = Math.floor(now.getTime() / 1000)
      return { iss: authConfig.issuer, aud: authConfig.audience, sub: token, iat: issuedAt, exp: issuedAt + 300 }
    },
  }
  const authUserResolver: AuthUserResolver = {
    resolve: async (_issuer, subject) => {
      if (subject === minorToken) return { id: minorId, role: 'student' }
      if (subject === guardianToken) return { id: guardianId, role: 'guardian' }
      return null
    },
  }
  const app = buildApp({ repository, config, tokenVerifier, authUserResolver, now: () => now })
  try {
    const minorHeaders = { authorization: `Bearer ${minorToken}`, 'x-client-platform': 'ios' }
    const guardianHeaders = { authorization: `Bearer ${guardianToken}` }

    const before = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: minorHeaders })
    printStep(log, '1. Minor starts before guardian verification', before.statusCode, before.json())

    const invite = await app.inject({ method: 'POST', url: '/v1/me/guardian-link/invitations', headers: minorHeaders })
    const inviteBody = invite.json<{ inviteCode: string; expiresAt: string }>()
    printStep(log, '2. Minor creates guardian invitation', invite.statusCode, inviteBody)

    const verified = await app.inject({
      method: 'PUT',
      url: '/v1/guardian-links/verification',
      headers: guardianHeaders,
      payload: { inviteCode: inviteBody.inviteCode },
    })
    printStep(log, '3. Guardian verifies invitation', verified.statusCode, verified.json())

    const granted = await app.inject({
      method: 'PUT',
      url: `/v1/guardian-links/${minorId}/consents/voice-processing`,
      headers: guardianHeaders,
      payload: { status: 'granted', version: 'v1' },
    })
    printStep(log, '4. Guardian grants voice consent for the minor', granted.statusCode, granted.json())

    const afterConsent = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: minorHeaders })
    printStep(log, '5. Minor capabilities show signed upload is available', afterConsent.statusCode, afterConsent.json())

    const ticket = await app.inject({
      method: 'POST',
      url: '/v1/me/voice-upload-ticket',
      headers: minorHeaders,
      payload: {
        contentType: 'audio/webm',
        contentLengthBytes: 4096,
        durationSeconds: 30,
        checksumSha256: 'a'.repeat(64),
      },
    })
    const ticketBody = ticket.json<{ fields?: Record<string, string>; objectKey?: string }>()
    printStep(log, '6. Minor requests constrained voice upload ticket', ticket.statusCode, {
      ...ticketBody,
      fields: ticketBody.fields ? { ...ticketBody.fields, policy: '<base64 policy omitted>', 'x-amz-signature': '<signature omitted>' } : undefined,
    })

    const device = await app.inject({
      method: 'PUT',
      url: '/v1/me/devices/current',
      headers: { authorization: `Bearer ${minorToken}` },
      payload: { platform: 'ios', deviceId: 'demo-device-1', appVersion: '1.0.0', osVersion: '17.5' },
    })
    printStep(log, '7. Minor registers current device metadata', device.statusCode, device.json())

    const pushDisabled = await app.inject({
      method: 'PUT',
      url: '/v1/me/devices/current/push-disabled',
      headers: { authorization: `Bearer ${minorToken}` },
      payload: { platform: 'ios', deviceId: 'demo-device-1', appVersion: '1.0.0', osVersion: '17.5' },
    })
    printStep(log, '8. Minor disables push for current device', pushDisabled.statusCode, pushDisabled.json())

    const withdrawn = await app.inject({
      method: 'PUT',
      url: `/v1/guardian-links/${minorId}/consents/voice-processing`,
      headers: guardianHeaders,
      payload: { status: 'withdrawn', version: 'v1' },
    })
    printStep(log, '9. Guardian withdraws voice consent', withdrawn.statusCode, withdrawn.json())

    const afterWithdrawal = await app.inject({ method: 'GET', url: '/v1/me/capabilities', headers: minorHeaders })
    printStep(log, '10. Minor capabilities disable voice upload after withdrawal', afterWithdrawal.statusCode, afterWithdrawal.json())

    printStep(log, '11. Deletion job scaffold queued locally', 200, repository.getVoiceDataDeletionJobsForTest())
  } finally {
    await app.close()
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await runApiDemo()
