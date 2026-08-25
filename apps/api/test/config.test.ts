import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('runtime configuration', () => {
  it('uses the unified dev port and web origin by default', () => {
    const config = loadConfig({ NODE_ENV: 'test' })
    expect(config.PORT).toBe(3000)
    expect(config.CORS_ORIGIN).toBe('http://localhost:5173')
  })

  it.each(['localhost:5173', 'http://localhost:5173/', 'http://localhost:5173/path', 'ftp://localhost:5173', 'http://user:pass@localhost:5173'])('rejects non-exact CORS origin %s', (origin) => {
    expect(() => loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: origin })).toThrow()
  })
})
