// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runLiveApiDemo } from './demoFlow'

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

describe('live API demo flow client', () => {
  it('creates a demo session and calls the backend flow with Bearer tokens', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/v1/demo/session') {
        return jsonResponse({
          studentId: 'student-live-demo',
          studentToken: 'student-token',
          guardianToken: 'guardian-token',
          expiresAt: '2026-08-30T12:10:00.000Z',
        }, 201)
      }
      if (url === '/v1/me/capabilities') return jsonResponse({ voiceUploadMode: 'disabled' })
      if (url === '/v1/me/guardian-link/invitations') return jsonResponse({ inviteCode: 'secret-invite', expiresAt: '2026-08-31T12:00:00.000Z' }, 201)
      if (url === '/v1/guardian-links/verification') return jsonResponse({ status: 'verified' })
      if (url.endsWith('/consents/voice-processing')) return jsonResponse({ status: url.includes('student-live-demo') ? 'granted' : 'withdrawn' })
      if (url === '/v1/me/voice-upload-ticket') {
        return jsonResponse({
          objectKey: 'voice/secret-key',
          fields: {
            key: 'voice/secret-key',
            policy: 'base64-policy',
            'x-amz-credential': 'credential',
            'x-amz-signature': 'signature',
          },
        })
      }
      if (url === '/v1/me/devices/current') return jsonResponse({ pushEnabled: false })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const checkpoints: unknown[] = []
    await runLiveApiDemo((checkpoint) => checkpoints.push(checkpoint))

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/v1/demo/session', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/v1/me/capabilities', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer student-token' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/v1/guardian-links/verification', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer guardian-token' }),
    }))
    expect(checkpoints).toHaveLength(7)
    expect(JSON.stringify(checkpoints)).toContain('<base64 policy omitted>')
    expect(JSON.stringify(checkpoints)).not.toContain('base64-policy')
    expect(JSON.stringify(checkpoints)).not.toContain('secret-invite')
  })
})
