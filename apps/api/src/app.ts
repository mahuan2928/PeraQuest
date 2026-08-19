import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { z } from 'zod'
import type {
  CapabilityResponse,
  ClientPlatform,
  ConsentResponse,
  GuardianLinkResponse,
  NotificationChannel,
  PaymentChannel,
  StudentOnboardingResponse,
  TrialAnswerResponse,
  TrialCompleteResponse,
  TrialSessionResponse,
} from '@peraquest/contracts'
import { loadConfig } from './config.js'
import { MemoryStudentRepository, type StudentRepository } from './repository.js'
import { trialQuestionSeeds } from './trial-content.js'

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
}

export const buildApp = (options: BuildAppOptions = {}) => {
  const app = Fastify({ logger: false })
  const config = loadConfig()
  const repository = options.repository ?? new MemoryStudentRepository()
  const now = options.now ?? (() => new Date())

  const studentIdFrom = (headers: Record<string, unknown>): string | null => {
    const value = headers['x-student-id']
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  app.get('/health', async () => ({ status: 'ok' as const }))

  app.post('/v1/students/onboarding', async (request, reply): Promise<StudentOnboardingResponse | void> => {
    const parsed = onboardingSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_ONBOARDING', details: parsed.error.issues })
    const id = randomUUID()
    const isMinor = isMinorAt(parsed.data.birthMonth, now())
    const birthMonthDate = new Date(`${parsed.data.birthMonth}-01T00:00:00Z`)
    if (birthMonthDate > now() || birthMonthDate.getUTCFullYear() < 1900) return reply.code(400).send({ code: 'INVALID_BIRTH_MONTH' })
    const guardianLinkStatus = isMinor ? 'pending' : 'not_required'
    await repository.create({ id, birthMonth: parsed.data.birthMonth, isMinor, guardianLinkStatus, guardianId: null })
    return reply.code(201).send({ studentId: id, isMinor, guardianLinkStatus, onboardingStatus: isMinor ? 'pending_guardian' : 'active' })
  })

  app.get('/v1/me/guardian-link', async (request, reply): Promise<GuardianLinkResponse | void> => {
    const studentId = studentIdFrom(request.headers)
    if (!studentId) return reply.code(401).send({ code: 'AUTH_REQUIRED' })
    const student = await repository.findById(studentId)
    if (!student) return reply.code(404).send({ code: 'STUDENT_NOT_FOUND' })
    return { status: student.guardianLinkStatus, purchaseAllowed: student.guardianLinkStatus === 'verified', verifiedAt: null }
  })

  app.put('/v1/me/consents/voice-processing', async (request, reply): Promise<ConsentResponse | void> => {
    const studentId = studentIdFrom(request.headers)
    if (!studentId) return reply.code(401).send({ code: 'AUTH_REQUIRED' })
    const parsed = consentSchema.safeParse(request.body)
    if (!parsed.success || parsed.data.version !== config.CONSENT_VERSION_REQUIRED) {
      return reply.code(400).send({ code: 'INVALID_CONSENT_VERSION', requiredVersion: config.CONSENT_VERSION_REQUIRED })
    }
    const student = await repository.findById(studentId)
    if (!student) return reply.code(404).send({ code: 'STUDENT_NOT_FOUND' })
    if (student.isMinor && student.guardianLinkStatus !== 'verified') return reply.code(403).send({ code: 'GUARDIAN_VERIFICATION_REQUIRED' })
    const guardianId = request.headers['x-guardian-id']
    if (student.isMinor && (typeof guardianId !== 'string' || guardianId !== student.guardianId)) return reply.code(403).send({ code: 'GUARDIAN_AUTH_REQUIRED' })
    const consent = await repository.setVoiceConsent(studentId, parsed.data.status, parsed.data.version)
    return { type: 'voice_processing', ...consent }
  })

  app.get('/v1/me/capabilities', async (request, reply): Promise<CapabilityResponse | void> => {
    const studentId = studentIdFrom(request.headers)
    const parsedPlatform = platformSchema.safeParse(request.headers['x-client-platform'])
    if (!studentId) return reply.code(401).send({ code: 'AUTH_REQUIRED' })
    if (!parsedPlatform.success) return reply.code(400).send({ code: 'INVALID_CLIENT_PLATFORM' })
    const student = await repository.findById(studentId)
    if (!student) return reply.code(404).send({ code: 'STUDENT_NOT_FOUND' })
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

  app.post('/v1/me/trial-sessions', async (request, reply): Promise<TrialSessionResponse | void> => {
    const studentId = studentIdFrom(request.headers)
    if (!studentId) return reply.code(401).send({ code: 'AUTH_REQUIRED' })
    const student = await repository.findById(studentId)
    if (!student) return reply.code(404).send({ code: 'STUDENT_NOT_FOUND' })
    if (student.guardianLinkStatus !== 'pending') return reply.code(403).send({ code: 'TRIAL_NOT_AVAILABLE' })
    if (await repository.hasRedeemedTrial(studentId)) return reply.code(409).send({ code: 'TRIAL_ALREADY_REDEEMED' })
    const sessionId = randomUUID()
    await repository.createTrialSession({ id: sessionId, studentId, answers: new Map(), completed: false })
    return {
      sessionId,
      questions: trialQuestionSeeds.map((question) => ({
        id: question.id,
        ability: question.ability,
        prompt: question.prompt,
        support: question.support,
        choices: [...question.choices],
      })),
    }
  })

  app.post<{ Params: { sessionId: string } }>('/v1/me/trial-sessions/:sessionId/answers', async (request, reply): Promise<TrialAnswerResponse | void> => {
    const studentId = studentIdFrom(request.headers)
    if (!studentId) return reply.code(401).send({ code: 'AUTH_REQUIRED' })
    const parsed = trialAnswerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_TRIAL_ANSWER' })
    const session = await repository.findTrialSession(request.params.sessionId)
    if (!session || session.studentId !== studentId) return reply.code(404).send({ code: 'TRIAL_SESSION_NOT_FOUND' })
    if (session.completed) return reply.code(409).send({ code: 'TRIAL_ALREADY_REDEEMED' })
    const question = trialQuestionSeeds.find(({ id }) => id === parsed.data.questionId)
    if (!question) return reply.code(400).send({ code: 'UNKNOWN_TRIAL_QUESTION' })
    const correct = parsed.data.answer === question.answer
    session.answers.set(question.id, correct)
    return { correct, correctAnswer: question.answer, explanation: question.explanation, answeredCount: session.answers.size }
  })

  app.post<{ Params: { sessionId: string } }>('/v1/me/trial-sessions/:sessionId/complete', async (request, reply): Promise<TrialCompleteResponse | void> => {
    const studentId = studentIdFrom(request.headers)
    if (!studentId) return reply.code(401).send({ code: 'AUTH_REQUIRED' })
    const session = await repository.findTrialSession(request.params.sessionId)
    if (!session || session.studentId !== studentId) return reply.code(404).send({ code: 'TRIAL_SESSION_NOT_FOUND' })
    if (session.completed || await repository.hasRedeemedTrial(studentId)) return reply.code(409).send({ code: 'TRIAL_ALREADY_REDEEMED' })
    if (session.answers.size !== trialQuestionSeeds.length) return reply.code(409).send({ code: 'TRIAL_INCOMPLETE' })
    await repository.completeTrialSession(session.id)
    return { score: [...session.answers.values()].filter(Boolean).length, total: trialQuestionSeeds.length, durableProgressWritten: false }
  })

  app.post('/v1/me/voice-upload-ticket', async (request, reply) => {
    const studentId = studentIdFrom(request.headers)
    if (!studentId) return reply.code(401).send({ code: 'AUTH_REQUIRED' })
    const student = await repository.findById(studentId)
    if (!student) return reply.code(404).send({ code: 'STUDENT_NOT_FOUND' })
    const consent = await repository.getVoiceConsent(studentId, config.CONSENT_VERSION_REQUIRED)
    const allowed = (!student.isMinor || student.guardianLinkStatus === 'verified') && consent.status === 'granted' && config.VOICE_FEATURE_PUBLIC_ENABLED && config.AI_VENDOR_APPROVED
    if (!allowed) return reply.code(403).send({ code: 'VOICE_CONSENT_REQUIRED' })
    return reply.code(501).send({ code: 'SIGNED_UPLOAD_NOT_CONFIGURED' })
  })

  return app
}
