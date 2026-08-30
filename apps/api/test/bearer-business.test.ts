import { createServer, type Server } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import type { AuthUserResolver, TokenVerifier } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import { MemoryStudentRepository, type StartStageAttemptInput, type SubmitStageAttemptInput } from '../src/repository.js'
import { buildServerApp } from '../src/server.js'
import type { StageAttemptResultResponse, StartStageAttemptResponse, StudentKnowledgeProjectionDto } from '@peraquest/contracts'

const STUDENT_A = '00000000-0000-0000-0000-000000000101'
const STUDENT_B = '00000000-0000-0000-0000-000000000102'
const ADULT_STUDENT = '00000000-0000-0000-0000-000000000103'
const VERIFIED_MINOR = '00000000-0000-0000-0000-000000000104'
const GUARDIAN = '00000000-0000-0000-0000-000000000105'

interface UserRow {
  id: string
  role: 'student' | 'guardian'
  birth_month: string | null
  is_minor: boolean
  status: 'pending' | 'verified' | null
  guardian_id: string | null
  deleted: boolean
}

const users = new Map<string, UserRow>([
  [STUDENT_A, { id: STUDENT_A, role: 'student', birth_month: '2012-04-01', is_minor: true, status: 'pending', guardian_id: null, deleted: false }],
  [STUDENT_B, { id: STUDENT_B, role: 'student', birth_month: '2012-05-01', is_minor: true, status: 'pending', guardian_id: null, deleted: false }],
  [ADULT_STUDENT, { id: ADULT_STUDENT, role: 'student', birth_month: '2000-01-01', is_minor: false, status: null, guardian_id: null, deleted: false }],
  [VERIFIED_MINOR, { id: VERIFIED_MINOR, role: 'student', birth_month: '2012-03-01', is_minor: true, status: 'verified', guardian_id: GUARDIAN, deleted: false }],
  ['deleted-user', { id: 'deleted-user', role: 'student', birth_month: '2012-06-01', is_minor: true, status: 'pending', guardian_id: null, deleted: true }],
  ['provider-mismatch-user', { id: 'provider-mismatch-user', role: 'student', birth_month: '2012-07-01', is_minor: true, status: 'pending', guardian_id: null, deleted: false }],
  [GUARDIAN, { id: GUARDIAN, role: 'guardian', birth_month: null, is_minor: false, status: null, guardian_id: null, deleted: false }],
])

const identities = new Map([
  ['email_magic_link:student-a-sub', STUDENT_A],
  ['email_magic_link:student-b-sub', STUDENT_B],
  ['email_magic_link:adult-sub', ADULT_STUDENT],
  ['email_magic_link:verified-minor-sub', VERIFIED_MINOR],
  ['email_magic_link:deleted-sub', 'deleted-user'],
  ['google:provider-mismatch-sub', 'provider-mismatch-user'],
  ['email_magic_link:guardian-sub', GUARDIAN],
])

const fakePool = {
  query: async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('FROM auth_identities ai')) {
      const userId = identities.get(`${String(parameters[0])}:${String(parameters[1])}`)
      const user = userId ? users.get(userId) : undefined
      return { rows: user && !user.deleted ? [{ id: user.id, role: user.role }] : [], rowCount: user && !user.deleted ? 1 : 0 }
    }
    if (sql.includes('FROM users u')) {
      const user = users.get(String(parameters[0]))
      return { rows: user && !user.deleted && user.role === 'student' ? [user] : [], rowCount: user ? 1 : 0 }
    }
    if (sql.includes('INSERT INTO consent_records')) return { rows: [], rowCount: 1 }
    throw new Error(`unexpected test query: ${sql}`)
  },
  end: async () => undefined,
} as unknown as Pool

describe('real Bearer business path', () => {
  let jwksServer: Server
  let app: ReturnType<typeof buildServerApp>
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
  const issuer = 'https://issuer.test'
  const audience = 'peraquest-api'
  const kid = 'business-path-key'

  const tokenFor = async (subject: string): Promise<string> => {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey)
  }

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256', { modulusLength: 2048 })
    privateKey = keyPair.privateKey
    const publicJwk = await exportJWK(keyPair.publicKey)
    jwksServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] }))
    })
    await new Promise<void>((resolve, reject) => {
      jwksServer.once('error', reject)
      jwksServer.listen(0, '127.0.0.1', resolve)
    })
    const address = jwksServer.address()
    if (!address || typeof address === 'string') throw new Error('JWKS test server did not bind')

    const config = loadConfig({
      NODE_ENV: 'test',
      AUTH_PROVIDER: 'email_magic_link',
      AUTH_ISSUER: issuer,
      AUTH_AUDIENCE: audience,
      AUTH_JWKS_URL: `http://127.0.0.1:${address.port}/jwks`,
      AUTH_CLOCK_SKEW_SECONDS: '0',
      CONSENT_VERSION_REQUIRED: 'v1',
    })
    app = buildServerApp(config, fakePool)
  })

  afterAll(async () => {
    await app.close()
    jwksServer.closeAllConnections()
    await new Promise<void>((resolve, reject) => jwksServer.close((error) => error ? reject(error) : resolve()))
  })

  it('uses a real RS256 token and the production Pool wiring to access a protected route', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { authorization: `Bearer ${await tokenFor('student-a-sub')}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'pending' })
  })

  it('allows an adult Bearer student to write their own voice consent', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { authorization: `Bearer ${await tokenFor('adult-sub')}` },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ type: 'voice_processing', status: 'granted', version: 'v1' })
  })

  it('does not let a Bearer student bypass minor guardian consent policy', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { authorization: `Bearer ${await tokenFor('verified-minor-sub')}` },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })
  })

  it.each([
    ['an unbound subject', 'unbound-sub'],
    ['a deleted user', 'deleted-sub'],
    ['a subject bound under a different provider', 'provider-mismatch-sub'],
  ])('rejects %s', async (_case, subject) => {
    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { authorization: `Bearer ${await tokenFor(subject)}` } })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ code: 'AUTH_INVALID' })
  })

  it('rejects bearer and legacy identity mixing on consent writes', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/me/consents/voice-processing',
      headers: { authorization: `Bearer ${await tokenFor('adult-sub')}`, 'x-student-id': STUDENT_A },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ code: 'AUTH_INVALID' })
  })

  it.each([
    ['GET', '/v1/me/guardian-link', undefined],
    ['GET', '/v1/me/capabilities', undefined],
    ['POST', '/v1/trial-attempts', undefined],
    ['POST', '/v1/trial-attempts/attempt/answers', { questionId: 'q1', answer: 'play' }],
    ['POST', '/v1/me/voice-upload-ticket', undefined],
  ] as const)('returns AUTH_FORBIDDEN for a non-student on %s %s', async (method, url, payload) => {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${await tokenFor('guardian-sub')}`, 'x-client-platform': 'pc' },
      ...(payload === undefined ? {} : { payload }),
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'AUTH_FORBIDDEN' })
  })
})

describe('student ownership from AuthActor', () => {
  it('prevents one student from answering another student trial attempt', async () => {
    const repository = new MemoryStudentRepository()
    await repository.create({ id: STUDENT_A, birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    await repository.create({ id: STUDENT_B, birthMonth: '2012-05', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    const nowSeconds = 1_800_000_000
    const verifier: TokenVerifier = {
      verify: async (token) => ({ iss: 'https://issuer.test', aud: 'peraquest-api', sub: token, iat: nowSeconds, exp: nowSeconds + 300 }),
    }
    const resolver: AuthUserResolver = {
      resolve: async (_issuer, subject) => ({ id: subject === 'student-a-sub' ? STUDENT_A : STUDENT_B, role: 'student' }),
    }
    const config = loadConfig({ NODE_ENV: 'test', AUTH_ISSUER: 'https://issuer.test', AUTH_AUDIENCE: 'peraquest-api' })
    const app = buildApp({ repository, tokenVerifier: verifier, authUserResolver: resolver, config, now: () => new Date(nowSeconds * 1000) })

    const started = await app.inject({ method: 'POST', url: '/v1/trial-attempts', headers: { authorization: 'Bearer student-b-sub' } })
    expect(started.statusCode).toBe(201)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/trial-attempts/${started.json().attemptId}/answers`,
      headers: { authorization: 'Bearer student-a-sub' },
      payload: { questionId: 'q1', answer: 'play' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ code: 'TRIAL_ATTEMPT_NOT_FOUND' })
    await app.close()
  })
})

describe('formal stage attempt Bearer authorization', () => {
  const nowSeconds = 1_800_000_000
  const examId = '00000000-0000-0000-0000-000000009001'
  const attemptResponse: StartStageAttemptResponse = {
    attemptId: '00000000-0000-0000-0000-000000009101',
    examVersionId: '00000000-0000-0000-0000-000000009201',
    status: 'open',
    startedAt: '2027-01-15T08:00:00.000Z',
    expiresAt: '2027-01-15T08:20:00.000Z',
    passScore: 0.8,
    items: [{
      itemId: '00000000-0000-0000-0000-000000009301',
      itemRef: 'item-1',
      ordinal: 1,
      prompt: 'Choose one.',
      support: null,
      points: 1,
      options: [
        { optionId: '00000000-0000-0000-0000-000000009401', text: 'Alpha' },
        { optionId: '00000000-0000-0000-0000-000000009402', text: 'Beta' },
      ],
    }],
  }
  const resultResponse: StageAttemptResultResponse = {
    attemptId: attemptResponse.attemptId,
    status: 'passed',
    submittedAt: '2027-01-15T08:05:00.000Z',
    rawScore: 1,
    maxScore: 1,
    score: 1,
    passed: true,
    passScore: 0.8,
    items: [{ itemId: attemptResponse.items[0]!.itemId, outcome: 'correct', earnedScore: 1, maxScore: 1 }],
  }
  const masteryProjection: StudentKnowledgeProjectionDto = {
    studentId: STUDENT_A,
    knowledgePointRef: 'vocab-alpha',
    rawCorrectTotal: 1,
    rawAttemptTotal: 1,
    masteryScore: 1,
    state: 'mastered',
    lastOccurredAt: '2027-01-15T08:05:00.000Z',
    dueAt: '2027-01-29T08:05:00.000Z',
    updatedAt: '2027-01-15T08:05:00.000Z',
  }

  class FormalAttemptRepository extends MemoryStudentRepository {
    readonly starts: StartStageAttemptInput[] = []
    readonly submits: SubmitStageAttemptInput[] = []
    readonly masteryReads: string[] = []

    async startStageAttempt(input: StartStageAttemptInput) {
      this.starts.push(input)
      return { status: 'created' as const, httpStatus: 201, attempt: attemptResponse }
    }

    async findStageAttempt(studentId: string, attemptId: string) {
      return studentId === STUDENT_A && attemptId === attemptResponse.attemptId ? attemptResponse : null
    }

    async submitStageAttempt(input: SubmitStageAttemptInput) {
      this.submits.push(input)
      return { status: 'submitted' as const, httpStatus: 200, result: resultResponse }
    }

    async findStageAttemptResult(studentId: string, attemptId: string) {
      return studentId === STUDENT_A && attemptId === attemptResponse.attemptId ? resultResponse : null
    }

    async listStudentKnowledgeProjections(studentId: string) {
      this.masteryReads.push(studentId)
      return studentId === STUDENT_A ? [masteryProjection] : []
    }
  }

  const buildFormalApp = async () => {
    const repository = new FormalAttemptRepository()
    await repository.create({ id: STUDENT_A, birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'verified', guardianId: GUARDIAN })
    await repository.create({ id: STUDENT_B, birthMonth: '2012-05', isMinor: true, guardianLinkStatus: 'verified', guardianId: GUARDIAN })
    const verifier: TokenVerifier = {
      verify: async (token) => ({ iss: 'https://issuer.test', aud: 'peraquest-api', sub: token, iat: nowSeconds, exp: nowSeconds + 300 }),
    }
    const resolver: AuthUserResolver = {
      resolve: async (_issuer, subject) => {
        if (subject === 'student-a-sub') return { id: STUDENT_A, role: 'student' }
        if (subject === 'student-b-sub') return { id: STUDENT_B, role: 'student' }
        if (subject === 'guardian-sub') return { id: GUARDIAN, role: 'guardian' }
        return null
      },
    }
    const config = loadConfig({ NODE_ENV: 'test', AUTH_PROVIDER: 'email_magic_link', AUTH_ISSUER: 'https://issuer.test', AUTH_AUDIENCE: 'peraquest-api' })
    const app = buildApp({ repository, tokenVerifier: verifier, authUserResolver: resolver, config, now: () => new Date(nowSeconds * 1000) })
    return { app, repository }
  }

  it('starts a formal attempt from the Bearer student and ignores a forged body studentId', async () => {
    const { app, repository } = await buildFormalApp()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stage-exams/${examId}/attempts`,
      headers: { authorization: 'Bearer student-a-sub', 'idempotency-key': 'start-key-1' },
      payload: { studentId: STUDENT_B },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(attemptResponse)
    expect(repository.starts).toHaveLength(1)
    expect(repository.starts[0]?.studentId).toBe(STUDENT_A)
    expect(repository.starts[0]?.stageExamId).toBe(examId)
    expect(repository.starts[0]?.actorProviderSubject).toBe('student-a-sub')
    await app.close()
  })

  it('rejects Guardian and legacy header attempts before repository start is called', async () => {
    const { app, repository } = await buildFormalApp()
    const guardian = await app.inject({
      method: 'POST',
      url: `/api/v1/stage-exams/${examId}/attempts`,
      headers: { authorization: 'Bearer guardian-sub', 'idempotency-key': 'start-key-1' },
    })
    expect(guardian.statusCode).toBe(403)
    expect(guardian.json()).toEqual({ code: 'AUTH_FORBIDDEN' })

    const legacy = await app.inject({
      method: 'POST',
      url: `/api/v1/stage-exams/${examId}/attempts`,
      headers: { 'x-student-id': STUDENT_A, 'idempotency-key': 'start-key-1' },
    })
    expect(legacy.statusCode).toBe(401)
    expect(legacy.json()).toEqual({ code: 'LEGACY_AUTH_NOT_ALLOWED' })
    expect(repository.starts).toHaveLength(0)
    await app.close()
  })

  it('does not let Student A read Student B stage attempts', async () => {
    const { app } = await buildFormalApp()
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stage-attempts/00000000-0000-0000-0000-000000009999`,
      headers: { authorization: 'Bearer student-a-sub' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ code: 'STAGE_ATTEMPT_NOT_FOUND' })
    await app.close()
  })

  it('submits formal answers from the Bearer student and rejects forged scoring fields', async () => {
    const { app, repository } = await buildFormalApp()
    const forged = await app.inject({
      method: 'POST',
      url: `/api/v1/stage-attempts/${attemptResponse.attemptId}/submit`,
      headers: { authorization: 'Bearer student-a-sub', 'idempotency-key': 'submit-key-1' },
      payload: {
        answers: [{ itemId: attemptResponse.items[0]!.itemId, selectedOptionId: attemptResponse.items[0]!.options[0]!.optionId }],
        score: 999,
      },
    })
    expect(forged.statusCode).toBe(400)
    expect(forged.json()).toEqual({ code: 'INVALID_STAGE_SUBMISSION' })
    expect(repository.submits).toHaveLength(0)

    const valid = await app.inject({
      method: 'POST',
      url: `/api/v1/stage-attempts/${attemptResponse.attemptId}/submit`,
      headers: { authorization: 'Bearer student-a-sub', 'idempotency-key': 'submit-key-2' },
      payload: {
        answers: [{ itemId: attemptResponse.items[0]!.itemId, selectedOptionId: attemptResponse.items[0]!.options[0]!.optionId }],
      },
    })
    expect(valid.statusCode).toBe(200)
    expect(valid.json()).toEqual(resultResponse)
    expect(repository.submits).toHaveLength(1)
    expect(repository.submits[0]?.studentId).toBe(STUDENT_A)
    expect(repository.submits[0]?.actorAuthProvider).toBe('email_magic_link')
    expect(repository.submits[0]?.actorProviderSubject).toBe('student-a-sub')
    expect(repository.submits[0]?.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(repository.submits[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/)
    await app.close()
  })

  it('rejects Guardian and legacy submit attempts before repository submit is called', async () => {
    const { app, repository } = await buildFormalApp()
    const payload = { answers: [{ itemId: attemptResponse.items[0]!.itemId, selectedOptionId: null }] }
    const guardian = await app.inject({
      method: 'POST',
      url: `/api/v1/stage-attempts/${attemptResponse.attemptId}/submit`,
      headers: { authorization: 'Bearer guardian-sub', 'idempotency-key': 'submit-key-1' },
      payload,
    })
    expect(guardian.statusCode).toBe(403)
    expect(guardian.json()).toEqual({ code: 'AUTH_FORBIDDEN' })

    const legacy = await app.inject({
      method: 'POST',
      url: `/api/v1/stage-attempts/${attemptResponse.attemptId}/submit`,
      headers: { 'x-student-id': STUDENT_A, 'idempotency-key': 'submit-key-1' },
      payload,
    })
    expect(legacy.statusCode).toBe(401)
    expect(legacy.json()).toEqual({ code: 'LEGACY_AUTH_NOT_ALLOWED' })
    expect(repository.submits).toHaveLength(0)
    await app.close()
  })

  it('does not let Student A read Student B stage attempt results', async () => {
    const { app } = await buildFormalApp()
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stage-attempts/00000000-0000-0000-0000-000000009999/result`,
      headers: { authorization: 'Bearer student-a-sub' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ code: 'STAGE_ATTEMPT_NOT_FOUND' })
    await app.close()
  })

  it('lists only the Bearer student mastery projections', async () => {
    const { app, repository } = await buildFormalApp()
    const studentA = await app.inject({
      method: 'GET',
      url: `/api/v1/student-knowledge?studentId=${STUDENT_B}`,
      headers: { authorization: 'Bearer student-a-sub' },
    })
    expect(studentA.statusCode).toBe(200)
    expect(studentA.json()).toEqual({ items: [masteryProjection] })
    expect(repository.masteryReads).toEqual([STUDENT_A])

    const studentB = await app.inject({
      method: 'GET',
      url: '/api/v1/student-knowledge',
      headers: { authorization: 'Bearer student-b-sub' },
    })
    expect(studentB.statusCode).toBe(200)
    expect(studentB.json()).toEqual({ items: [] })
    expect(repository.masteryReads).toEqual([STUDENT_A, STUDENT_B])
    await app.close()
  })

  it('rejects Guardian and legacy mastery reads before repository read is called', async () => {
    const { app, repository } = await buildFormalApp()
    const guardian = await app.inject({
      method: 'GET',
      url: '/api/v1/student-knowledge',
      headers: { authorization: 'Bearer guardian-sub' },
    })
    expect(guardian.statusCode).toBe(403)
    expect(guardian.json()).toEqual({ code: 'AUTH_FORBIDDEN' })

    const legacy = await app.inject({
      method: 'GET',
      url: '/api/v1/student-knowledge',
      headers: { 'x-student-id': STUDENT_A },
    })
    expect(legacy.statusCode).toBe(401)
    expect(legacy.json()).toEqual({ code: 'LEGACY_AUTH_NOT_ALLOWED' })
    expect(repository.masteryReads).toEqual([])
    await app.close()
  })
})
