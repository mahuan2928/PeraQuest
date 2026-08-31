// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApiUrl, normalizeApiBaseUrl, submitTrialAnswer } from './onboarding'

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('API base URL handling', () => {
  it.each([
    ['', '/v1/health'],
    ['https://dev.example.test', '/v1/health'],
    ['https://dev.example.test/', '/v1/health'],
  ])('joins %s with a path without duplicate slashes', (baseUrl, path) => {
    expect(buildApiUrl(path, normalizeApiBaseUrl(baseUrl))).toBe(`${baseUrl.replace(/\/+$/, '')}${path}`)
  })

  it('normalizes an empty VITE_API_BASE_URL to same-origin requests', () => {
    expect(normalizeApiBaseUrl('')).toBe('')
    expect(buildApiUrl('/v1/students/onboarding', normalizeApiBaseUrl(''))).toBe('/v1/students/onboarding')
  })

  it('treats an undefined VITE_API_BASE_URL as same-origin', () => {
    expect(normalizeApiBaseUrl(undefined)).toBe('')
  })

  it('preserves an API origin that has no trailing slash', () => {
    expect(normalizeApiBaseUrl('https://dev.example.test')).toBe('https://dev.example.test')
  })

  it('removes all trailing slashes before joining a path', () => {
    expect(buildApiUrl('/v1/health', normalizeApiBaseUrl('https://dev.example.test///'))).toBe('https://dev.example.test/v1/health')
  })

  it('preserves the structured API code for an expired trial answer', async () => {
    sessionStorage.setItem('lingoquest.student.id', 'student-test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ code: 'TRIAL_ATTEMPT_EXPIRED' }),
    }))

    await expect(submitTrialAnswer('expired-attempt', { questionId: 'q1', answer: 'play' }))
      .rejects.toEqual(expect.objectContaining({
        name: 'ApiRequestError',
        message: 'REQUEST_FAILED_410',
        status: 410,
        code: 'TRIAL_ATTEMPT_EXPIRED',
      }))
  })
})
