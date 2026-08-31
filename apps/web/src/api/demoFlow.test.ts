// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoSession, setDemoVoiceConsent } from './demoFlow'

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
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
})
