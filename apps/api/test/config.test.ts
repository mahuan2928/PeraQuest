import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('runtime configuration', () => {
  it('uses the unified dev port and web origin by default', () => {
    const config = loadConfig({ NODE_ENV: 'test' })
    expect(config.PORT).toBe(3000)
    expect(config.CORS_ORIGIN).toBe('http://localhost:5173')
    expect(config.DEMO_API_ENABLED).toBe(false)
  })

  it('requires an explicit demo secret before enabling demo API sessions', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', DEMO_API_ENABLED: 'true' })).toThrow('DEMO_SESSION_SECRET is required')
    expect(loadConfig({ NODE_ENV: 'test', DEMO_API_ENABLED: 'true', DEMO_SESSION_SECRET: 'local-demo-session-secret' }).DEMO_API_ENABLED).toBe(true)
  })

  it.each(['localhost:5173', 'http://localhost:5173/', 'http://localhost:5173/path', 'ftp://localhost:5173', 'http://user:pass@localhost:5173'])('rejects non-exact CORS origin %s', (origin) => {
    expect(() => loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: origin })).toThrow()
  })

  it('fails closed when production auth configuration is absent or insecure', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('AUTH_ISSUER is required in production')
    expect(() => loadConfig({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'email_magic_link',
      AUTH_ISSUER: 'http://issuer.example.test',
      AUTH_AUDIENCE: 'peraquest-api',
      AUTH_JWKS_URL: 'http://issuer.example.test/jwks',
    })).toThrow('must use HTTPS')
  })

  it('accepts explicit HTTPS production auth configuration', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'email_magic_link',
      AUTH_ISSUER: 'https://issuer.example.test',
      AUTH_AUDIENCE: 'peraquest-api',
      AUTH_JWKS_URL: 'https://issuer.example.test/.well-known/jwks.json',
    })
    expect(config.ALLOW_LEGACY_TEST_HEADERS).toBe(false)
    expect(config.DEMO_API_ENABLED).toBe(false)
    expect(config.AUTH_PROVIDER).toBe('email_magic_link')
  })

  it('keeps the demo entrance shut in production unless the deployment declares itself a demo', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'email_magic_link',
      AUTH_ISSUER: 'https://issuer.example.test',
      AUTH_AUDIENCE: 'peraquest-api',
      AUTH_JWKS_URL: 'https://issuer.example.test/.well-known/jwks.json',
      DEMO_API_ENABLED: 'true',
      DEMO_SESSION_SECRET: 'hosted-demo-session-secret',
    })
    // 宣言していない本番では、DEMO_API_ENABLED を立てても開きません。
    expect(config.DEMO_API_ENABLED).toBe(false)
  })

  it('opens the demo entrance for a declared demo deployment without loosening production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'email_magic_link',
      AUTH_ISSUER: 'https://issuer.example.test',
      AUTH_AUDIENCE: 'peraquest-api',
      AUTH_JWKS_URL: 'https://issuer.example.test/.well-known/jwks.json',
      DEMO_API_ENABLED: 'true',
      DEMO_DEPLOYMENT: 'true',
      DEMO_SESSION_SECRET: 'hosted-demo-session-secret',
      ALLOW_LEGACY_TEST_HEADERS: 'true',
    })
    expect(config.DEMO_API_ENABLED).toBe(true)
    // デモを開けても、テスト用ヘッダは本番では閉じたままです。ここが緩んだら意味がありません。
    expect(config.ALLOW_LEGACY_TEST_HEADERS).toBe(false)
  })

  it('refuses a declared demo deployment that has no session secret', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'email_magic_link',
      AUTH_ISSUER: 'https://issuer.example.test',
      AUTH_AUDIENCE: 'peraquest-api',
      AUTH_JWKS_URL: 'https://issuer.example.test/.well-known/jwks.json',
      DEMO_API_ENABLED: 'true',
      DEMO_DEPLOYMENT: 'true',
    })).toThrow('DEMO_SESSION_SECRET is required')
  })
})
