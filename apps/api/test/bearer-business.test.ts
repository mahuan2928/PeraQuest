import { createServer, type Server } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import type { AuthUserResolver, TokenVerifier } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import { MemoryStudentRepository, type StartStageAttemptInput } from '../src/repository.js'
import { buildServerApp } from '../src/server.js'
import type { StartStageAttemptResponse } from '@peraquest/contracts'

const STUDENT_A = '00000000-0000-0000-0000-000000000101'
const STUDENT_B = '00000000-0000-0000-0000-000000000102'
const GUARDIAN = '00000000-0000-0000-0000-000000000105'

interface UserRow {
  id: string
  role: 'student' | 'guardian'
  birth_month: string | null
  is_minor: boolean
  status: 'pending' | null
  guardian_id: string | null
  deleted: boolean
}

const users = new Map<string, UserRow>([
  [STUDENT_A, { id: STUDENT_A, role: 'student', birth_month: '2012-04-01', is_minor: true, status: 'pending', guardian_id: null, deleted: false }],
  [STUDENT_B, { id: STUDENT_B, role: 'student', birth_month: '2012-05-01', is_minor: true, status: 'pending', guardian_id: null, deleted: false }],
  ['deleted-user', { id: 'deleted-user', role: 'student', birth_month: '2012-06-01', is_minor: true, status: 'pending', guardian_id: null, deleted: true }],
  ['provider-mismatch-user', { id: 'provider-mismatch-user', role: 'student', birth_month: '2012-07-01', is_minor: true, status: 'pending', guardian_id: null, deleted: false }],
  [GUARDIAN, { id: GUARDIAN, role: 'guardian', birth_month: null, is_minor: false, status: null, guardian_id: null, deleted: false }],
])

const identities = new Map([
  ['email_magic_link:student-a-sub', STUDENT_A],
  ['email_magic_link:student-b-sub', STUDENT_B],
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

  it.each([
    ['an unbound subject', 'unbound-sub'],
    ['a deleted user', 'deleted-sub'],
    ['a subject bound under a different provider', 'provider-mismatch-sub'],
  ])('rejects %s', async (_case, subject) => {
    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { authorization: `Bearer ${await tokenFor(subject)}` } })
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

  class FormalAttemptRepository extends MemoryStudentRepository {
    readonly starts: StartStageAttemptInput[] = []

    async startStageAttempt(input: StartStageAttemptInput) {
      this.starts.push(input)
      return { status: 'created' as const, httpStatus: 201, attempt: attemptResponse }
    }

    async findStageAttempt(studentId: string, attemptId: string) {
      return studentId === STUDENT_A && attemptId === attemptResponse.attemptId ? attemptResponse : null
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
})
