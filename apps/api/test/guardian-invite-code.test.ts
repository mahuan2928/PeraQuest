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
})

const issueInvite = async () => {
  const app = buildApp({ repository: new MemoryStudentRepository(), config: demoConfig })
  const session = await app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })
  const { studentToken, guardianToken } = session.json<{ studentToken: string; guardianToken: string }>()
  const invitation = await app.inject({
    method: 'POST',
    url: '/v1/me/guardian-link/invitations',
    headers: { authorization: `Bearer ${studentToken}` },
  })
  expect(invitation.statusCode).toBe(201)
  return { app, guardianToken, inviteCode: invitation.json<{ inviteCode: string }>().inviteCode }
}

const verify = (app: Awaited<ReturnType<typeof issueInvite>>['app'], guardianToken: string, inviteCode: string) =>
  app.inject({
    method: 'PUT',
    url: '/v1/guardian-links/verification',
    headers: { authorization: `Bearer ${guardianToken}`, 'content-type': 'application/json' },
    payload: { inviteCode },
  })

describe('guardian invite code', () => {
  it('is short enough to read out and drops the characters people confuse', async () => {
    const { app, inviteCode } = await issueInvite()
    // 大文字のみ、5 文字ずつ。0/O/1/I/L は形が近いので使いません。
    expect(inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
    expect(inviteCode).not.toMatch(/[0O1IL]/)
    await app.close()
  })

  it.each([
    ['そのまま', (code: string) => code],
    ['小文字で', (code: string) => code.toLowerCase()],
    ['区切りなし', (code: string) => code.replace('-', '')],
    ['空白区切り', (code: string) => code.replace('-', ' ')],
    ['前後に空白', (code: string) => ` ${code} `],
  ])('照合できる: %s', async (_label, transform) => {
    const { app, guardianToken, inviteCode } = await issueInvite()
    const response = await verify(app, guardianToken, transform(inviteCode))
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('still rejects a code that is simply wrong', async () => {
    const { app, guardianToken } = await issueInvite()
    const response = await verify(app, guardianToken, 'ZZZZZ-ZZZZZ')
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})
