import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { sanitizeErrorDetails } from '@peraquest/contracts'
import type {
  CapabilityResponse,
  ClientPlatform,
  ConsentResponse,
  CurrentDevicePushDisableResponse,
  CurrentDeviceRegistrationResponse,
  GuardianInvitationResponse,
  GuardianLinkResponse,
  GuardianLinkVerificationResponse,
  GuardianVoiceConsentWriteResponse,
  NotificationChannel,
  PaymentChannel,
  StudentOnboardingResponse,
  StartStageAttemptResponse,
  StageAttemptResultResponse,
  StudentKnowledgeProjectionListResponse,
  SubmitStageAttemptRequest,
  TrialAnswerResponse,
  TrialAttemptResponse,
  StableErrorCode,
  AuthActor,
  VoiceUploadTicketResponse,
} from '@peraquest/contracts'
import { loadConfig, type RuntimeConfig } from './config.js'
import { AuthFailure, createAuthActor, createJwksTokenVerifier, legacyActor, parseBearerToken, verifyClaims, type AuthConfig, type AuthUserResolver, type TokenVerifier, type VerifiedTokenClaims } from './auth.js'
import { MemoryStudentRepository, type StudentRecord, type StudentRepository } from './repository.js'
import { publicTrialQuestion, trialQuestions } from './trial.js'

const platformSchema = z.enum(['ios', 'android', 'pc'])
const onboardingSchema = z.object({
  birthMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  targetExam: z.literal('eiken_grade_3'),
  authProvider: z.enum(['apple', 'google', 'email_magic_link']),
  client: z.object({
    platform: platformSchema,
    deviceId: z.string().min(1).max(200).optional(),
    appVersion: z.string().min(1).max(50).optional(),
    osVersion: z.string().min(1).max(100).optional(),
  }),
})
const consentSchema = z.object({ status: z.enum(['granted', 'denied', 'withdrawn']), version: z.string().min(1) })
const currentDeviceSchema = z.object({
  platform: platformSchema,
  deviceId: z.string().min(1).max(200),
  appVersion: z.string().min(1).max(50).optional(),
  osVersion: z.string().min(1).max(100).optional(),
}).strict()
const voiceUploadTicketSchema = z.object({
  contentType: z.enum(['audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a']),
  contentLengthBytes: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict()
const demoSessionSchema = z.object({ scenario: z.literal('minor_guardian_voice').optional() }).strict()
const trialAnswerSchema = z.object({ questionId: z.string().min(1), answer: z.string().min(1).max(200) })
const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const guardianInviteCodeSchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/)
const guardianLinkVerificationSchema = z.object({ inviteCode: guardianInviteCodeSchema }).strict()
const submitStageAttemptSchema = z.object({
  answers: z.array(z.object({
    itemId: uuidSchema,
    selectedOptionId: uuidSchema.nullable(),
  }).strict()).min(1).max(200),
}).strict()

const sendError = (reply: FastifyReply, statusCode: number, code: StableErrorCode, details?: unknown) => {
  const safeDetails = sanitizeErrorDetails(details)
  return reply.code(statusCode).send(safeDetails === undefined ? { code } : { code, details: safeDetails })
}

const isMinorAt = (birthMonth: string, now: Date): boolean => {
  const [year, month] = birthMonth.split('-').map(Number)
  if (year === undefined || month === undefined) return true
  const age = now.getUTCFullYear() - year - (now.getUTCMonth() + 1 < month ? 1 : 0)
  return age < 18
}

const channelsFor = (platform: ClientPlatform): { payments: PaymentChannel[]; notifications: NotificationChannel[] } => {
  if (platform === 'ios') return { payments: ['apple_app_store'], notifications: ['ios_push', 'line'] }
  if (platform === 'android') return { payments: ['google_play'], notifications: ['android_push', 'line'] }
  return { payments: ['web_checkout'], notifications: ['web_push', 'line'] }
}

const hashDeviceId = (studentId: string, deviceId: string): string => createHash('sha256')
  .update('peraquest:user-device:v1:')
  .update(studentId)
  .update(':')
  .update(deviceId)
  .digest('hex')

const hashGuardianInviteCode = (inviteCode: string): string => createHash('sha256')
  .update('peraquest:guardian-invite:v1:')
  .update(inviteCode)
  .digest('hex')

const createGuardianInviteCode = (): string => randomBytes(24).toString('base64url')
const encodeDemoTokenPart = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const signDemoToken = (payload: string, secret: string): string => createHmac('sha256', secret).update(payload).digest('base64url')

const compactDate = (date: Date): string => date.toISOString().slice(0, 10).replaceAll('-', '')
const amzDate = (date: Date): string => date.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z')
const hmac = (key: string | Buffer, value: string): Buffer => createHmac('sha256', key).update(value).digest()
const signingKey = (secret: string, date: string, region: string): Buffer => hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request')
const isVoiceUploadConfigured = (config: RuntimeConfig): boolean =>
  Boolean(config.VOICE_UPLOAD_BUCKET && config.VOICE_UPLOAD_REGION && config.VOICE_UPLOAD_ENDPOINT && config.VOICE_UPLOAD_ACCESS_KEY_ID && config.VOICE_UPLOAD_SECRET_ACCESS_KEY)

const createVoiceUploadTicket = (input: {
  studentId: string
  contentType: string
  contentLengthBytes: number
  durationSeconds: number
  checksumSha256: string
  issuedAt: Date
  config: RuntimeConfig
}): VoiceUploadTicketResponse => {
  const bucket = input.config.VOICE_UPLOAD_BUCKET!
  const region = input.config.VOICE_UPLOAD_REGION!
  const endpoint = input.config.VOICE_UPLOAD_ENDPOINT!.replace(/\/+$/, '')
  const accessKeyId = input.config.VOICE_UPLOAD_ACCESS_KEY_ID!
  const secretAccessKey = input.config.VOICE_UPLOAD_SECRET_ACCESS_KEY!
  const date = compactDate(input.issuedAt)
  const timestamp = amzDate(input.issuedAt)
  const expiresAt = new Date(input.issuedAt.getTime() + input.config.VOICE_UPLOAD_TICKET_TTL_SECONDS * 1000)
  const credential = `${accessKeyId}/${date}/${region}/s3/aws4_request`
  const objectKey = `voice/${date}/${input.studentId}/${randomUUID()}`
  const fields: Record<string, string> = {
    key: objectKey,
    bucket,
    'Content-Type': input.contentType,
    'x-amz-algorithm': 'AWS4-HMAC-SHA256',
    'x-amz-credential': credential,
    'x-amz-date': timestamp,
    'x-amz-meta-student-id': input.studentId,
    'x-amz-meta-checksum-sha256': input.checksumSha256.toLowerCase(),
    'x-amz-meta-duration-seconds': String(Math.ceil(input.durationSeconds)),
  }
  const policy = {
    expiration: expiresAt.toISOString(),
    conditions: [
      { bucket },
      { key: objectKey },
      { 'Content-Type': input.contentType },
      ['content-length-range', 1, input.config.VOICE_UPLOAD_MAX_BYTES],
      { 'x-amz-algorithm': fields['x-amz-algorithm'] },
      { 'x-amz-credential': credential },
      { 'x-amz-date': timestamp },
      { 'x-amz-meta-student-id': input.studentId },
      { 'x-amz-meta-checksum-sha256': fields['x-amz-meta-checksum-sha256'] },
      { 'x-amz-meta-duration-seconds': fields['x-amz-meta-duration-seconds'] },
    ],
  }
  const policyBase64 = Buffer.from(JSON.stringify(policy)).toString('base64')
  fields.policy = policyBase64
  fields['x-amz-signature'] = createHmac('sha256', signingKey(secretAccessKey, date, region)).update(policyBase64).digest('hex')
  return {
    uploadUrl: `${endpoint}/${bucket}`,
    method: 'POST',
    fields,
    objectKey,
    bucket,
    region,
    expiresAt: expiresAt.toISOString(),
    maxBytes: input.config.VOICE_UPLOAD_MAX_BYTES,
    maxDurationSeconds: input.config.VOICE_UPLOAD_MAX_DURATION_SECONDS,
  }
}

export interface BuildAppOptions {
  repository?: StudentRepository
  now?: () => Date
  tokenVerifier?: TokenVerifier
  authUserResolver?: AuthUserResolver
  config?: RuntimeConfig
}

export const buildApp = (options: BuildAppOptions = {}) => {
  const app = Fastify({ logger: false })
  const config = options.config ?? loadConfig()
  const repository = options.repository ?? new MemoryStudentRepository()
  const authConfig: AuthConfig = {
    issuer: config.AUTH_ISSUER,
    audience: config.AUTH_AUDIENCE,
    jwksUrl: config.AUTH_JWKS_URL,
    clockSkewSeconds: config.AUTH_CLOCK_SKEW_SECONDS,
    maxTokenTtlSeconds: config.AUTH_MAX_TOKEN_TTL_SECONDS,
    jwksCacheMaxAgeMs: config.AUTH_JWKS_CACHE_MAX_AGE_MS,
    jwksCooldownMs: config.AUTH_JWKS_COOLDOWN_MS,
    jwksTimeoutMs: config.AUTH_JWKS_TIMEOUT_MS,
  }
  const tokenVerifier = options.tokenVerifier ?? createJwksTokenVerifier(authConfig)
  const authUserResolver = options.authUserResolver ?? { resolve: async () => null }
  const now = options.now ?? (() => new Date())
  const demoSessions = new Map<string, { studentId: string; guardianId: string; expiresAt: Date }>()

  const createDemoToken = (sessionId: string, role: 'student' | 'guardian'): string => {
    const issuedAt = Math.floor(now().getTime() / 1000)
    const payload = {
      iss: config.AUTH_ISSUER,
      aud: config.AUTH_AUDIENCE,
      sub: `demo:${sessionId}:${role}`,
      iat: issuedAt,
      exp: issuedAt + config.DEMO_TOKEN_TTL_SECONDS,
    }
    const encodedPayload = encodeDemoTokenPart(payload)
    return `demo.${encodedPayload}.${signDemoToken(encodedPayload, config.DEMO_SESSION_SECRET!)}`
  }

  const verifyDemoToken = (token: string): ReturnType<TokenVerifier['verify']> | null => {
    if (!config.DEMO_API_ENABLED || !token.startsWith('demo.')) return null
    const [, encodedPayload, signature] = token.split('.')
    if (!encodedPayload || !signature || signature !== signDemoToken(encodedPayload, config.DEMO_SESSION_SECRET!)) throw new AuthFailure('AUTH_INVALID')
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown
    const claims = z.object({
      iss: z.string(),
      aud: z.union([z.string(), z.array(z.string())]),
      sub: z.string(),
      iat: z.number(),
      exp: z.number(),
    }).parse(payload)
    return Promise.resolve(claims)
  }

  const activeTokenVerifier: TokenVerifier = {
    async verify(token, verifierConfig) {
      const demoClaims = verifyDemoToken(token)
      if (demoClaims) return demoClaims
      return tokenVerifier.verify(token, verifierConfig)
    },
  }

  const activeAuthUserResolver: AuthUserResolver = {
    async resolve(issuer, providerSubject) {
      if (config.DEMO_API_ENABLED && issuer === config.AUTH_ISSUER && providerSubject.startsWith('demo:')) {
        const [, sessionId, role] = providerSubject.split(':')
        const session = sessionId ? demoSessions.get(sessionId) : undefined
        if (!session || session.expiresAt <= now()) return null
        if (role === 'student') return { id: session.studentId, role: 'student' }
        if (role === 'guardian') return { id: session.guardianId, role: 'guardian' }
        return null
      }
      return authUserResolver.resolve(issuer, providerSubject)
    },
  }
  app.setErrorHandler((error, _request, reply) => {
    // Keep provider/raw/stack/token details server-side; the public contract exposes only a stable code.
    return sendError(reply, 500, 'INTERNAL_ERROR')
  })

  const allowedOrigin = config.CORS_ORIGIN
  app.decorateRequest('authActor', null as unknown as AuthActor)
  const corsHeaders = {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-client-platform,idempotency-key',
    vary: 'Origin',
  }

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin === allowedOrigin) {
      for (const [name, value] of Object.entries(corsHeaders)) reply.header(name, value)
    }
    if (request.method === 'OPTIONS') {
      if (origin !== allowedOrigin) return sendError(reply, 403, 'CORS_ORIGIN_DENIED')
      return reply.code(204).send()
    }
    // Requests carrying an Origin must be from the configured web client. Requests
    // without Origin are still handled by the endpoint's normal authentication.
    if (origin !== undefined && origin !== allowedOrigin) return sendError(reply, 403, 'CORS_ORIGIN_DENIED')
  })

  const studentIdFrom = (headers: Record<string, unknown>): string | null => {
    const value = headers['x-student-id']
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const studentActorId = (request: FastifyRequest, reply: FastifyReply): string | null => {
    if (request.authActor.role !== 'student') {
      sendError(reply, 403, 'AUTH_FORBIDDEN')
      return null
    }
    return request.authActor.id
  }

  const formalStudentActor = (request: FastifyRequest, reply: FastifyReply): { id: string; providerSubject: string } | null => {
    if (request.authActor.method !== 'bearer') {
      sendError(reply, 401, 'LEGACY_AUTH_NOT_ALLOWED')
      return null
    }
    if (request.authActor.role !== 'student') {
      sendError(reply, 403, 'AUTH_FORBIDDEN')
      return null
    }
    if (!request.authActor.providerSubject) {
      sendError(reply, 401, 'AUTH_INVALID')
      return null
    }
    return { id: request.authActor.id, providerSubject: request.authActor.providerSubject }
  }

  const formalGuardianActor = (request: FastifyRequest, reply: FastifyReply): { id: string; providerSubject: string } | null => {
    if (request.authActor.method !== 'bearer') {
      sendError(reply, 401, 'LEGACY_AUTH_NOT_ALLOWED')
      return null
    }
    if (request.authActor.role !== 'guardian') {
      sendError(reply, 403, 'AUTH_FORBIDDEN')
      return null
    }
    if (!request.authActor.providerSubject) {
      sendError(reply, 401, 'AUTH_INVALID')
      return null
    }
    return { id: request.authActor.id, providerSubject: request.authActor.providerSubject }
  }

  const formalProtectedPath = (url: string): boolean => url.startsWith('/api/v1/stage-exams/') || url.startsWith('/api/v1/stage-attempts/') || url.startsWith('/api/v1/student-knowledge') || url.startsWith('/v1/me/devices/current') || url.startsWith('/v1/me/guardian-link/invitations') || url.startsWith('/v1/guardian-links/verification') || url.startsWith('/v1/guardian-links/')
  const protectedPath = (url: string): boolean => formalProtectedPath(url) || url.startsWith('/v1/me/') || url.startsWith('/v1/trial-attempts')
  app.addHook('preValidation', async (request, reply) => {
    if (!protectedPath(request.url)) return
    try {
      const authorization = request.headers.authorization
      if (authorization !== undefined) {
        if (request.headers['x-student-id'] !== undefined || request.headers['x-guardian-id'] !== undefined) throw new AuthFailure('AUTH_INVALID')
        const token = parseBearerToken(authorization)
        request.authActor = await createAuthActor(token, authConfig, activeTokenVerifier, activeAuthUserResolver, () => now().getTime())
        return
      }
      if (formalProtectedPath(request.url) && (request.headers['x-student-id'] !== undefined || request.headers['x-guardian-id'] !== undefined)) {
        return reply.code(401).send({ code: 'LEGACY_AUTH_NOT_ALLOWED' })
      }
      if (formalProtectedPath(request.url)) throw new AuthFailure('AUTH_REQUIRED')
      if (config.ALLOW_LEGACY_TEST_HEADERS) {
        const actor = legacyActor(request.headers)
        if (actor) { request.authActor = actor; return }
      }
      throw new AuthFailure('AUTH_REQUIRED')
    } catch (error) {
      const code = error instanceof AuthFailure ? error.code : 'AUTH_INVALID'
      return reply.code(401).send({ code })
    }
  })

  app.get('/health', async () => ({ status: 'ok' as const }))

  if (config.DEMO_API_ENABLED) {
    app.post('/v1/demo/session', async (request, reply) => {
      const parsed = demoSessionSchema.safeParse(request.body ?? {})
      if (!parsed.success) return sendError(reply, 400, 'VALIDATION_FAILED', { resource: 'demo_session', reason: 'invalid' })
      const sessionId = randomUUID()
      const studentId = randomUUID()
      const guardianId = randomUUID()
      const expiresAt = new Date(now().getTime() + config.DEMO_TOKEN_TTL_SECONDS * 1000)
      await repository.create({
        id: studentId,
        birthMonth: '2012-04',
        isMinor: true,
        guardianLinkStatus: 'pending',
        guardianId: null,
      })
      await repository.createDemoGuardian?.(guardianId)
      await repository.createDemoAuthIdentity?.(studentId, config.AUTH_PROVIDER, `demo:${sessionId}:student`)
      await repository.createDemoAuthIdentity?.(guardianId, config.AUTH_PROVIDER, `demo:${sessionId}:guardian`)
      demoSessions.set(sessionId, { studentId, guardianId, expiresAt })
      return reply.code(201).send({
        scenario: parsed.data.scenario ?? 'minor_guardian_voice',
        studentId,
        expiresAt: expiresAt.toISOString(),
        studentToken: createDemoToken(sessionId, 'student'),
        guardianToken: createDemoToken(sessionId, 'guardian'),
      })
    })

  }

  app.post('/v1/students/onboarding', async (request, reply): Promise<StudentOnboardingResponse | void> => {
    const parsed = onboardingSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'INVALID_ONBOARDING', { reason: 'invalid', resource: 'request' })
    let registrationClaims: VerifiedTokenClaims | null = null
    if (request.headers.authorization !== undefined) {
      if (parsed.data.authProvider !== config.AUTH_PROVIDER) return sendError(reply, 401, 'AUTH_INVALID')
      try {
        const token = parseBearerToken(request.headers.authorization)
        registrationClaims = await activeTokenVerifier.verify(token, authConfig)
        verifyClaims(registrationClaims, authConfig, now().getTime())
      } catch {
        return sendError(reply, 401, 'AUTH_INVALID')
      }
    }
    const id = randomUUID()
    const isMinor = isMinorAt(parsed.data.birthMonth, now())
    const birthMonthDate = new Date(`${parsed.data.birthMonth}-01T00:00:00Z`)
    if (birthMonthDate > now() || birthMonthDate.getUTCFullYear() < 1900) return sendError(reply, 400, 'INVALID_BIRTH_MONTH')
    const guardianLinkStatus = isMinor ? 'pending' : 'not_required'
    const student: StudentRecord = { id, birthMonth: parsed.data.birthMonth, isMinor, guardianLinkStatus, guardianId: null }
    if (registrationClaims) {
      const created = await repository.createWithAuthIdentity(student, config.AUTH_PROVIDER, registrationClaims.sub)
      if (created.status === 'identity_conflict') return sendError(reply, 409, 'REVISION_CONFLICT')
    } else {
      await repository.create(student)
    }
    return reply.code(201).send({ studentId: id, isMinor, guardianLinkStatus, onboardingStatus: isMinor ? 'pending_guardian' : 'active' })
  })

  app.get('/v1/me/guardian-link', async (request, reply): Promise<GuardianLinkResponse | void> => {
    const studentId = studentActorId(request, reply)
    if (!studentId) return
    const student = await repository.findById(studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    return { status: student.guardianLinkStatus, purchaseAllowed: student.guardianLinkStatus === 'verified', verifiedAt: null }
  })

  app.post('/v1/me/guardian-link/invitations', async (request, reply): Promise<GuardianInvitationResponse | void> => {
    const actor = formalStudentActor(request, reply)
    if (!actor) return
    const student = await repository.findById(actor.id)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    if (!student.isMinor || student.guardianLinkStatus !== 'pending') return sendError(reply, 409, 'REVISION_CONFLICT')
    const inviteCode = createGuardianInviteCode()
    const createdAt = now()
    const expiresAt = new Date(createdAt.getTime() + 1000 * 60 * 60 * 24)
    const invite = await repository.createGuardianInvite({
      studentId: actor.id,
      inviteCode,
      inviteCodeHash: hashGuardianInviteCode(inviteCode),
      expiresAt,
      createdAt,
    })
    if (!invite) return sendError(reply, 409, 'REVISION_CONFLICT')
    return reply.code(201).send(invite)
  })

  app.put('/v1/guardian-links/verification', async (request, reply): Promise<GuardianLinkVerificationResponse | void> => {
    const actor = formalGuardianActor(request, reply)
    if (!actor) return
    const parsed = guardianLinkVerificationSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_FAILED', { resource: 'guardian_link', reason: 'invalid' })
    const verified = await repository.verifyGuardianInvite({
      guardianId: actor.id,
      inviteCodeHash: hashGuardianInviteCode(parsed.data.inviteCode),
      verifiedAt: now(),
    })
    if (!verified) return sendError(reply, 404, 'NOT_FOUND')
    return verified
  })

  app.put('/v1/guardian-links/:studentId/consents/voice-processing', async (request, reply): Promise<GuardianVoiceConsentWriteResponse | void> => {
    const actor = formalGuardianActor(request, reply)
    if (!actor) return
    const params = z.object({ studentId: uuidSchema }).safeParse(request.params)
    if (!params.success) return sendError(reply, 400, 'VALIDATION_FAILED', { resource: 'guardian_link', reason: 'invalid' })
    const parsed = consentSchema.safeParse(request.body)
    if (!parsed.success || parsed.data.version !== config.CONSENT_VERSION_REQUIRED) {
      return sendError(reply, 400, 'INVALID_CONSENT_VERSION', { field: 'version', reason: 'invalid', resource: 'consent' })
    }
    const student = await repository.findById(params.data.studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    if (!student.isMinor) return sendError(reply, 403, 'AUTH_FORBIDDEN')
    if (student.guardianLinkStatus !== 'verified') return sendError(reply, 403, 'GUARDIAN_VERIFICATION_REQUIRED')
    if (student.guardianId !== actor.id) return sendError(reply, 403, 'GUARDIAN_AUTH_REQUIRED')
    const consent = await repository.setVoiceConsent(params.data.studentId, actor.id, parsed.data.status, parsed.data.version)
    return { type: 'voice_processing', ...consent }
  })

  app.put('/v1/me/consents/voice-processing', async (request, reply): Promise<ConsentResponse | void> => {
    let studentId: string | null
    let guardianId: string | null = null
    if (request.authActor.method === 'bearer') {
      if (request.authActor.role !== 'student') return sendError(reply, 403, 'AUTH_FORBIDDEN')
      studentId = request.authActor.id
    } else {
      studentId = studentIdFrom(request.headers)
      guardianId = typeof request.headers['x-guardian-id'] === 'string' ? request.headers['x-guardian-id'] : null
    }
    if (!studentId) return sendError(reply, 401, 'AUTH_REQUIRED')
    const parsed = consentSchema.safeParse(request.body)
    if (!parsed.success || parsed.data.version !== config.CONSENT_VERSION_REQUIRED) {
      return sendError(reply, 400, 'INVALID_CONSENT_VERSION', { field: 'version', reason: 'invalid', resource: 'consent' })
    }
    const student = await repository.findById(studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    if (student.isMinor && student.guardianLinkStatus !== 'verified') return sendError(reply, 403, 'GUARDIAN_VERIFICATION_REQUIRED')
    if (student.isMinor && (guardianId === null || guardianId !== student.guardianId)) return sendError(reply, 403, 'GUARDIAN_AUTH_REQUIRED')
    const consent = await repository.setVoiceConsent(studentId, student.isMinor ? guardianId : null, parsed.data.status, parsed.data.version)
    return { type: 'voice_processing', ...consent }
  })

  app.get('/v1/me/capabilities', async (request, reply): Promise<CapabilityResponse | void> => {
    const studentId = studentActorId(request, reply)
    if (!studentId) return
    const parsedPlatform = platformSchema.safeParse(request.headers['x-client-platform'])
    if (!parsedPlatform.success) return sendError(reply, 400, 'INVALID_CLIENT_PLATFORM')
    const student = await repository.findById(studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    const voiceConsent = await repository.getVoiceConsent(studentId, config.CONSENT_VERSION_REQUIRED)
    const entitlements = await repository.listActiveEntitlements(studentId, now())
    const clientChannels = channelsFor(parsedPlatform.data)
    const guardianSatisfied = !student.isMinor || student.guardianLinkStatus === 'verified'
    const canUploadVoice = guardianSatisfied && voiceConsent.status === 'granted' && config.VOICE_FEATURE_PUBLIC_ENABLED && config.AI_VENDOR_APPROVED
    return {
      examLevel: 'eiken_grade_3',
      platform: parsedPlatform.data,
      canLearn: guardianSatisfied,
      canUploadVoice,
      voiceUploadMode: canUploadVoice ? 'signed_upload' : 'disabled',
      canPurchase: false,
      guardianLinkStatus: student.guardianLinkStatus,
      voiceConsentStatus: voiceConsent.status,
      consentVersionRequired: config.CONSENT_VERSION_REQUIRED,
      paymentChannels: clientChannels.payments,
      notificationChannels: clientChannels.notifications,
      lineReturnTargets: parsedPlatform.data === 'pc' ? ['web_https'] : ['app_deep_link', 'web_https'],
      entitlements,
    }
  })

  app.put('/v1/me/devices/current', async (request, reply): Promise<CurrentDeviceRegistrationResponse | void> => {
    const actor = formalStudentActor(request, reply)
    if (!actor) return
    const parsed = currentDeviceSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_FAILED', { resource: 'device', reason: 'invalid' })
    const student = await repository.findById(actor.id)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    return repository.upsertCurrentDevice({
      studentId: actor.id,
      platform: parsed.data.platform,
      deviceIdHash: hashDeviceId(actor.id, parsed.data.deviceId),
      ...(parsed.data.appVersion === undefined ? {} : { appVersion: parsed.data.appVersion }),
      ...(parsed.data.osVersion === undefined ? {} : { osVersion: parsed.data.osVersion }),
      lastSeenAt: now(),
    })
  })

  app.put('/v1/me/devices/current/push-disabled', async (request, reply): Promise<CurrentDevicePushDisableResponse | void> => {
    const actor = formalStudentActor(request, reply)
    if (!actor) return
    const parsed = currentDeviceSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_FAILED', { resource: 'device', reason: 'invalid' })
    const student = await repository.findById(actor.id)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    const disabled = await repository.disableCurrentDevicePush({
      studentId: actor.id,
      platform: parsed.data.platform,
      deviceIdHash: hashDeviceId(actor.id, parsed.data.deviceId),
      ...(parsed.data.appVersion === undefined ? {} : { appVersion: parsed.data.appVersion }),
      ...(parsed.data.osVersion === undefined ? {} : { osVersion: parsed.data.osVersion }),
      lastSeenAt: now(),
    })
    if (!disabled) return sendError(reply, 404, 'NOT_FOUND')
    return disabled
  })

  app.post('/v1/trial-attempts', async (request, reply): Promise<TrialAttemptResponse | void> => {
    const studentId = studentActorId(request, reply)
    if (!studentId) return
    const student = await repository.findById(studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    if (!student.isMinor || student.guardianLinkStatus !== 'pending') return sendError(reply, 403, 'TRIAL_NOT_AVAILABLE')
    const attemptId = randomUUID()
    const expiresAt = new Date(now().getTime() + 30 * 60 * 1000)
    const result = await repository.startTrial(studentId, attemptId, expiresAt)
    if (result.status === 'redeemed') return sendError(reply, 409, 'TRIAL_ALREADY_REDEEMED')
    return reply.code(201).send({
      attemptId,
      questionCount: trialQuestions.length,
      question: publicTrialQuestion(trialQuestions[0]!),
      expiresAt: expiresAt.toISOString(),
      progressPersisted: false,
    })
  })

  app.post<{ Params: { stageExamId: string } }>('/api/v1/stage-exams/:stageExamId/attempts', async (request, reply): Promise<StartStageAttemptResponse | void> => {
    const actor = formalStudentActor(request, reply)
    if (!actor) return
    const parsedExamId = uuidSchema.safeParse(request.params.stageExamId)
    if (!parsedExamId.success) return sendError(reply, 404, 'STAGE_EXAM_NOT_AVAILABLE')
    const rawIdempotencyKey = request.headers['idempotency-key']
    const parsedIdempotencyKey = typeof rawIdempotencyKey === 'string' ? idempotencyKeySchema.safeParse(rawIdempotencyKey) : null
    if (!parsedIdempotencyKey) return sendError(reply, 400, 'IDEMPOTENCY_KEY_REQUIRED')
    if (!parsedIdempotencyKey.success) return sendError(reply, 400, 'IDEMPOTENCY_KEY_INVALID')

    const student = await repository.findById(actor.id)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    const requestHash = createHash('sha256')
      .update('POST\n/api/v1/stage-exams/')
      .update(parsedExamId.data)
      .update('/attempts\nformal')
      .digest()
    const result = await repository.startStageAttempt({
      studentId: actor.id,
      stageExamId: parsedExamId.data,
      attemptId: randomUUID(),
      idempotencyKey: parsedIdempotencyKey.data,
      requestHash,
      actorAuthProvider: config.AUTH_PROVIDER,
      actorProviderSubject: actor.providerSubject,
      eventId: randomUUID(),
      requestId: randomUUID(),
    })
    switch (result.status) {
      case 'created':
      case 'replayed':
        return reply.code(result.httpStatus).send(result.attempt)
      case 'exam_not_available':
        return sendError(reply, 404, 'STAGE_EXAM_NOT_AVAILABLE')
      case 'already_open':
        return sendError(reply, 409, 'STAGE_ATTEMPT_ALREADY_OPEN')
      case 'request_in_progress':
        return sendError(reply, 409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS')
      case 'key_reused':
        return sendError(reply, 409, 'IDEMPOTENCY_KEY_REUSED')
    }
  })

  app.get<{ Params: { stageAttemptId: string } }>('/api/v1/stage-attempts/:stageAttemptId', async (request, reply): Promise<StartStageAttemptResponse | void> => {
    const actor = formalStudentActor(request, reply)
    if (!actor) return
    const parsedAttemptId = uuidSchema.safeParse(request.params.stageAttemptId)
    if (!parsedAttemptId.success) return sendError(reply, 404, 'STAGE_ATTEMPT_NOT_FOUND')
    const attempt = await repository.findStageAttempt(actor.id, parsedAttemptId.data)
    if (!attempt) return sendError(reply, 404, 'STAGE_ATTEMPT_NOT_FOUND')
    return attempt
  })

  app.post<{ Params: { stageAttemptId: string } }>('/api/v1/stage-attempts/:stageAttemptId/submit', async (request, reply): Promise<StageAttemptResultResponse | void> => {
    const actor = formalStudentActor(request, reply)
    if (!actor) return
    const parsedAttemptId = uuidSchema.safeParse(request.params.stageAttemptId)
    if (!parsedAttemptId.success) return sendError(reply, 404, 'STAGE_ATTEMPT_NOT_FOUND')
    const rawIdempotencyKey = request.headers['idempotency-key']
    const parsedIdempotencyKey = typeof rawIdempotencyKey === 'string' ? idempotencyKeySchema.safeParse(rawIdempotencyKey) : null
    if (!parsedIdempotencyKey) return sendError(reply, 400, 'IDEMPOTENCY_KEY_REQUIRED')
    if (!parsedIdempotencyKey.success) return sendError(reply, 400, 'IDEMPOTENCY_KEY_INVALID')
    const parsed = submitStageAttemptSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'INVALID_STAGE_SUBMISSION')

    const body: SubmitStageAttemptRequest = parsed.data
    const requestHash = createHash('sha256')
      .update('POST\n/api/v1/stage-attempts/')
      .update(parsedAttemptId.data)
      .update('/submit\n')
      .update(JSON.stringify(body.answers))
      .digest()
    const result = await repository.submitStageAttempt({
      studentId: actor.id,
      attemptId: parsedAttemptId.data,
      idempotencyKey: parsedIdempotencyKey.data,
      requestHash,
      actorAuthProvider: config.AUTH_PROVIDER,
      actorProviderSubject: actor.providerSubject,
      eventId: randomUUID(),
      requestId: randomUUID(),
      answers: body.answers,
    })
    switch (result.status) {
      case 'submitted':
      case 'replayed':
        return reply.code(result.httpStatus).send(result.result)
      case 'attempt_not_found':
        return sendError(reply, 404, 'STAGE_ATTEMPT_NOT_FOUND')
      case 'already_finalized':
        return sendError(reply, 409, 'STAGE_ATTEMPT_ALREADY_FINALIZED')
      case 'expired':
        return sendError(reply, 410, 'STAGE_ATTEMPT_EXPIRED')
      case 'invalid_submission':
        return sendError(reply, 400, 'INVALID_STAGE_SUBMISSION')
      case 'request_in_progress':
        return sendError(reply, 409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS')
      case 'key_reused':
        return sendError(reply, 409, 'IDEMPOTENCY_KEY_REUSED')
    }
  })

  app.get<{ Params: { stageAttemptId: string } }>('/api/v1/stage-attempts/:stageAttemptId/result', async (request, reply): Promise<StageAttemptResultResponse | void> => {
    const actor = formalStudentActor(request, reply)
    if (!actor) return
    const parsedAttemptId = uuidSchema.safeParse(request.params.stageAttemptId)
    if (!parsedAttemptId.success) return sendError(reply, 404, 'STAGE_ATTEMPT_NOT_FOUND')
    const result = await repository.findStageAttemptResult(actor.id, parsedAttemptId.data)
    if (!result) return sendError(reply, 404, 'STAGE_ATTEMPT_NOT_FOUND')
    return result
  })

  app.get('/api/v1/student-knowledge', async (request, reply): Promise<StudentKnowledgeProjectionListResponse | void> => {
    const actor = formalStudentActor(request, reply)
    if (!actor) return
    const items = await repository.listStudentKnowledgeProjections(actor.id)
    return { items }
  })

  app.post<{ Params: { attemptId: string } }>('/v1/trial-attempts/:attemptId/answers', async (request, reply): Promise<TrialAnswerResponse | void> => {
    const studentId = studentActorId(request, reply)
    if (!studentId) return
    const parsed = trialAnswerSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'INVALID_TRIAL_ANSWER')
    const attempt = await repository.findTrialAttempt(request.params.attemptId)
    if (!attempt || attempt.studentId !== studentId) return sendError(reply, 404, 'TRIAL_ATTEMPT_NOT_FOUND')
    if (attempt.expiresAt <= now()) {
      await repository.completeTrialAttempt(attempt.id)
      return sendError(reply, 410, 'TRIAL_ATTEMPT_EXPIRED')
    }
    const question = trialQuestions[attempt.currentIndex]
    if (!question || parsed.data.questionId !== question.id) return sendError(reply, 409, 'TRIAL_ANSWER_OUT_OF_SEQUENCE')
    const correct = parsed.data.answer === question.answer
    const advanced = await repository.advanceTrialAttempt(attempt.id, attempt.currentIndex, correct)
    if (!advanced) return sendError(reply, 409, 'TRIAL_ANSWER_ALREADY_SUBMITTED')
    const completed = advanced.currentIndex === trialQuestions.length
    const nextQuestion = completed ? null : publicTrialQuestion(trialQuestions[advanced.currentIndex]!)
    if (completed) await repository.completeTrialAttempt(attempt.id)
    return {
      correct,
      correctAnswer: question.answer,
      explanation: question.explanation,
      completed,
      nextQuestion,
      score: completed ? advanced.score : null,
      progressPersisted: false,
    }
  })

  app.post('/v1/me/voice-upload-ticket', async (request, reply): Promise<VoiceUploadTicketResponse | void> => {
    const studentId = studentActorId(request, reply)
    if (!studentId) return
    const student = await repository.findById(studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    const consent = await repository.getVoiceConsent(studentId, config.CONSENT_VERSION_REQUIRED)
    const allowed = (!student.isMinor || student.guardianLinkStatus === 'verified') && consent.status === 'granted' && config.VOICE_FEATURE_PUBLIC_ENABLED && config.AI_VENDOR_APPROVED
    if (!allowed) return sendError(reply, 403, 'VOICE_CONSENT_REQUIRED')
    if (!isVoiceUploadConfigured(config)) return sendError(reply, 501, 'SIGNED_UPLOAD_NOT_CONFIGURED')
    const parsed = voiceUploadTicketSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_FAILED', { resource: 'voice_upload', reason: 'invalid' })
    if (parsed.data.contentLengthBytes > config.VOICE_UPLOAD_MAX_BYTES || parsed.data.durationSeconds > config.VOICE_UPLOAD_MAX_DURATION_SECONDS) {
      return sendError(reply, 400, 'VALIDATION_FAILED', { resource: 'voice_upload', reason: 'limit_exceeded' })
    }
    return createVoiceUploadTicket({
      studentId,
      contentType: parsed.data.contentType,
      contentLengthBytes: parsed.data.contentLengthBytes,
      durationSeconds: parsed.data.durationSeconds,
      checksumSha256: parsed.data.checksumSha256,
      issuedAt: now(),
      config,
    })
  })

  return app
}
