import { createHash, randomUUID } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { sanitizeErrorDetails } from '@peraquest/contracts'
import type {
  CapabilityResponse,
  ClientPlatform,
  ConsentResponse,
  GuardianLinkResponse,
  NotificationChannel,
  PaymentChannel,
  StudentOnboardingResponse,
  StartStageAttemptResponse,
  TrialAnswerResponse,
  TrialAttemptResponse,
  StableErrorCode,
  AuthActor,
} from '@peraquest/contracts'
import { loadConfig, type RuntimeConfig } from './config.js'
import { AuthFailure, createAuthActor, createJwksTokenVerifier, legacyActor, parseBearerToken, type AuthConfig, type AuthUserResolver, type TokenVerifier } from './auth.js'
import { MemoryStudentRepository, type StudentRepository } from './repository.js'
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
const trialAnswerSchema = z.object({ questionId: z.string().min(1), answer: z.string().min(1).max(200) })
const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)

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
  app.setErrorHandler((error, _request, reply) => {
    // Keep provider/raw/stack/token details server-side; the public contract exposes only a stable code.
    return sendError(reply, 500, 'INTERNAL_ERROR')
  })

  const allowedOrigin = config.CORS_ORIGIN
  app.decorateRequest('authActor', null as unknown as AuthActor)
  const corsHeaders = {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-client-platform',
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

  const formalProtectedPath = (url: string): boolean => url.startsWith('/api/v1/stage-exams/') || url.startsWith('/api/v1/stage-attempts/')
  const protectedPath = (url: string): boolean => formalProtectedPath(url) || url.startsWith('/v1/me/') || url.startsWith('/v1/trial-attempts')
  app.addHook('preValidation', async (request, reply) => {
    if (!protectedPath(request.url)) return
    try {
      const authorization = request.headers.authorization
      if (authorization !== undefined) {
        if (request.headers['x-student-id'] !== undefined || request.headers['x-guardian-id'] !== undefined) throw new AuthFailure('AUTH_INVALID')
        const token = parseBearerToken(authorization)
        request.authActor = await createAuthActor(token, authConfig, tokenVerifier, authUserResolver, () => now().getTime())
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

  app.post('/v1/students/onboarding', async (request, reply): Promise<StudentOnboardingResponse | void> => {
    const parsed = onboardingSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'INVALID_ONBOARDING', { reason: 'invalid', resource: 'request' })
    const id = randomUUID()
    const isMinor = isMinorAt(parsed.data.birthMonth, now())
    const birthMonthDate = new Date(`${parsed.data.birthMonth}-01T00:00:00Z`)
    if (birthMonthDate > now() || birthMonthDate.getUTCFullYear() < 1900) return sendError(reply, 400, 'INVALID_BIRTH_MONTH')
    const guardianLinkStatus = isMinor ? 'pending' : 'not_required'
    await repository.create({ id, birthMonth: parsed.data.birthMonth, isMinor, guardianLinkStatus, guardianId: null })
    return reply.code(201).send({ studentId: id, isMinor, guardianLinkStatus, onboardingStatus: isMinor ? 'pending_guardian' : 'active' })
  })

  app.get('/v1/me/guardian-link', async (request, reply): Promise<GuardianLinkResponse | void> => {
    const studentId = studentActorId(request, reply)
    if (!studentId) return
    const student = await repository.findById(studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    return { status: student.guardianLinkStatus, purchaseAllowed: student.guardianLinkStatus === 'verified', verifiedAt: null }
  })

  app.put('/v1/me/consents/voice-processing', async (request, reply): Promise<ConsentResponse | void> => {
    const studentId = studentIdFrom(request.headers)
    if (!studentId) return sendError(reply, 401, 'AUTH_REQUIRED')
    const parsed = consentSchema.safeParse(request.body)
    if (!parsed.success || parsed.data.version !== config.CONSENT_VERSION_REQUIRED) {
      return sendError(reply, 400, 'INVALID_CONSENT_VERSION', { field: 'version', reason: 'invalid', resource: 'consent' })
    }
    const student = await repository.findById(studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    if (student.isMinor && student.guardianLinkStatus !== 'verified') return sendError(reply, 403, 'GUARDIAN_VERIFICATION_REQUIRED')
    const guardianHeader = request.headers['x-guardian-id']
    const guardianId = typeof guardianHeader === 'string' ? guardianHeader : null
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
      entitlements: [],
    }
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

  app.post('/v1/me/voice-upload-ticket', async (request, reply) => {
    const studentId = studentActorId(request, reply)
    if (!studentId) return
    const student = await repository.findById(studentId)
    if (!student) return sendError(reply, 404, 'STUDENT_NOT_FOUND')
    const consent = await repository.getVoiceConsent(studentId, config.CONSENT_VERSION_REQUIRED)
    const allowed = (!student.isMinor || student.guardianLinkStatus === 'verified') && consent.status === 'granted' && config.VOICE_FEATURE_PUBLIC_ENABLED && config.AI_VENDOR_APPROVED
    if (!allowed) return sendError(reply, 403, 'VOICE_CONSENT_REQUIRED')
    return sendError(reply, 501, 'SIGNED_UPLOAD_NOT_CONFIGURED')
  })

  return app
}
