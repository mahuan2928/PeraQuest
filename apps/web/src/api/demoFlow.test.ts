// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoSession, registerDemoDevice, setDemoVoiceConsent } from './demoFlow'

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response
}

function textResponse(data: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => data,
  } as Response
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('product demo API client', () => {
  it('creates a demo session through the backend', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      studentId: 'student-live-demo',
      studentToken: 'student-token',
      guardianToken: 'guardian-token',
      expiresAt: '2026-08-30T12:10:00.000Z',
    }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const response = await createDemoSession()

    expect(fetchMock).toHaveBeenCalledWith('/v1/demo/session', expect.objectContaining({ method: 'POST' }))
    expect(response.status).toBe(201)
    expect(response.body.studentToken).toBe('student-token')
  })

  it('returns backend rejection bodies without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'GUARDIAN_VERIFICATION_REQUIRED' }, 403)))

    const response = await setDemoVoiceConsent('guardian-token', 'student-live-demo', 'granted')

    expect(response.ok).toBe(false)
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ code: 'GUARDIAN_VERIFICATION_REQUIRED' })
  })

  it('keeps empty successful responses from becoming connection errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('', 204)))

    const response = await registerDemoDevice('student-token')

    expect(response.ok).toBe(true)
    expect(response.status).toBe(204)
    expect(response.body).toEqual({})
  })

  it('returns non-json error text without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('temporary backend error', 502)))

    const response = await registerDemoDevice('student-token')

    expect(response.ok).toBe(false)
    expect(response.status).toBe(502)
    expect(response.body).toEqual({ message: 'temporary backend error' })
  })
})
