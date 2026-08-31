import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { AuthFailure, createJwksTokenVerifier, type AuthConfig } from '../src/auth.js'

interface TestKey { kid: string; privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']; jwk: JWK }

const makeKey = async (kid: string): Promise<TestKey> => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 })
  const jwk = await exportJWK(publicKey)
  return { kid, privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } }
}

const sign = async (key: TestKey, overrides: Record<string, unknown> = {}, algorithm = 'RS256'): Promise<string> => {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    marker: 'must-not-leak',
    iss: 'https://issuer.test',
    aud: 'peraquest-api',
    sub: 'provider-subject',
    iat: now,
    exp: now + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: algorithm, kid: key.kid, typ: 'JWT' })
    .sign(key.privateKey)
}

class TemporaryJwksServer {
  server: Server | undefined
  keys: JWK[] = []
  requests = 0
  delayMs = 0
  statusCode = 200
  url = ''

  async start(): Promise<void> {
    this.server = createServer(async (_request, response) => {
      this.requests += 1
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
      response.writeHead(this.statusCode, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ keys: this.keys }))
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('temporary JWKS server did not bind')
    this.url = `http://127.0.0.1:${address.port}/.well-known/jwks.json`
  }

  async close(): Promise<void> {
    if (!this.server) return
    this.server.closeAllConnections()
    await new Promise<void>((resolve, reject) => this.server!.close((error) => error ? reject(error) : resolve()))
  }
}

const configFor = (server: TemporaryJwksServer, overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  issuer: 'https://issuer.test',
  audience: 'peraquest-api',
  jwksUrl: server.url,
  clockSkewSeconds: 0,
  maxTokenTtlSeconds: 600,
  jwksCacheMaxAgeMs: 60_000,
  jwksCooldownMs: 30_000,
  jwksTimeoutMs: 1_000,
  ...overrides,
})

describe('RS256 remote JWKS verifier', () => {
  let server: TemporaryJwksServer
  let primary: TestKey

  beforeEach(async () => {
    server = new TemporaryJwksServer()
    primary = await makeKey('primary-key')
    server.keys = [primary.jwk]
    await server.start()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await server.close()
  })

  it('verifies RS256 issuer, audience and required time claims and caches JWKS', async () => {
    const config = configFor(server)
    const verifier = createJwksTokenVerifier(config)
    const token = await sign(primary)

    await expect(verifier.verify(token, config)).resolves.toMatchObject({ sub: 'provider-subject' })
    await expect(verifier.verify(token, config)).resolves.toMatchObject({ sub: 'provider-subject' })
    expect(server.requests).toBe(1)
  })

  it.each([
    ['wrong issuer', { iss: 'https://evil.test' }],
    ['wrong audience', { aud: 'other-api' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['future nbf', { nbf: Math.floor(Date.now() / 1000) + 120 }],
    ['future iat', { iat: Math.floor(Date.now() / 1000) + 120 }],
    ['excessive ttl', { iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 601 }],
  ])('rejects %s', async (_name, overrides) => {
    const config = configFor(server)
    await expect(createJwksTokenVerifier(config).verify(await sign(primary, overrides), config)).rejects.toEqual(new AuthFailure('AUTH_INVALID'))
  })

  it.each(['iat', 'exp'])('rejects a missing %s claim', async (missingClaim) => {
    const now = Math.floor(Date.now() / 1000)
    const payload: Record<string, unknown> = {
      iss: 'https://issuer.test',
      aud: 'peraquest-api',
      sub: 'provider-subject',
      iat: now,
      exp: now + 300,
    }
    delete payload[missingClaim]
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: primary.kid })
      .sign(primary.privateKey)
    const config = configFor(server)
    await expect(createJwksTokenVerifier(config).verify(token, config)).rejects.toThrow('AUTH_INVALID')
  })

  it('rejects algorithm confusion and signatures from an untrusted key', async () => {
    const config = configFor(server)
    const secret = randomBytes(32)
    const now = Math.floor(Date.now() / 1000)
    const hs256 = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', kid: primary.kid })
      .setIssuer(config.issuer).setAudience(config.audience).setSubject('provider-subject')
      .setIssuedAt(now).setExpirationTime(now + 300).sign(secret)
    const attacker = await makeKey('primary-key')

    await expect(createJwksTokenVerifier(config).verify(hs256, config)).rejects.toThrow('AUTH_INVALID')
    await expect(createJwksTokenVerifier(config).verify(await sign(attacker), config)).rejects.toThrow('AUTH_INVALID')
  })

  it('refreshes keys on rotation after the configured cooldown', async () => {
    const config = configFor(server, { jwksCooldownMs: 0 })
    const verifier = createJwksTokenVerifier(config)
    await verifier.verify(await sign(primary), config)

    const rotated = await makeKey('rotated-key')
    server.keys = [rotated.jwk]
    await expect(verifier.verify(await sign(rotated), config)).resolves.toMatchObject({ sub: 'provider-subject' })
    expect(server.requests).toBe(2)
  })

  it('honors the unknown-key refresh cooldown', async () => {
    const config = configFor(server, { jwksCooldownMs: 60_000 })
    const verifier = createJwksTokenVerifier(config)
    await verifier.verify(await sign(primary), config)

    const unknown = await makeKey('unknown-key')
    server.keys = [unknown.jwk]
    await expect(verifier.verify(await sign(unknown), config)).rejects.toThrow('AUTH_INVALID')
    expect(server.requests).toBe(1)
  })

  it('fails closed when JWKS retrieval times out', async () => {
    server.delayMs = 200
    const config = configFor(server, { jwksTimeoutMs: 20 })
    await expect(createJwksTokenVerifier(config).verify(await sign(primary), config)).rejects.toThrow('AUTH_INVALID')
  })

  it('fails closed on a JWKS provider error', async () => {
    server.statusCode = 503
    const config = configFor(server)
    await expect(createJwksTokenVerifier(config).verify(await sign(primary), config)).rejects.toEqual(new AuthFailure('AUTH_INVALID'))
  })

  it('returns only the stable auth code and never provider or token details', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('AUTH_ISSUER', 'https://issuer.test')
    vi.stubEnv('AUTH_AUDIENCE', 'peraquest-api')
    vi.stubEnv('AUTH_JWKS_URL', server.url)
    vi.stubEnv('AUTH_JWKS_TIMEOUT_MS', '20')
    server.delayMs = 200
    const token = `secret.${'sensitive'.repeat(8)}.token`
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/v1/me/guardian-link', headers: { authorization: `Bearer ${token}` } })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ code: 'AUTH_INVALID' })
    expect(response.body).not.toContain(token)
    expect(response.body).not.toContain(server.url)
    expect(response.body).not.toContain(primary.kid)
    await app.close()
  })
})
