import type {
  CapabilityResponse,
  GuardianLinkResponse,
  StudentOnboardingResponse,
  TrialAnswerRequest,
  TrialAnswerResponse,
  TrialAttemptResponse,
} from '@peraquest/contracts'

export function normalizeApiBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? '').replace(/\/+$/, '')
}

const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL)

export function buildApiUrl(path: string, baseUrl = API_BASE_URL): string {
  return `${baseUrl}${path}`
}

function detectClientPlatform(): 'ios' | 'android' | 'pc' {
  if (/Android/i.test(navigator.userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios'
  return 'pc'
}

function studentHeaders(): HeadersInit {
  const studentId = sessionStorage.getItem('lingoquest.student.id')
  if (!studentId) throw new Error('STUDENT_SESSION_MISSING')
  return {
    'x-student-id': studentId,
    'x-client-platform': detectClientPlatform(),
  }
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(url), init)
  if (!response.ok) {
    const error = new Error(`REQUEST_FAILED_${response.status}`)
    Object.assign(error, { status: response.status })
    throw error
  }
  return response.json() as Promise<T>
}

export function createStudentOnboarding(birthMonth: string): Promise<StudentOnboardingResponse> {
  return jsonRequest('/v1/students/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      birthMonth,
      targetExam: 'eiken_grade_3',
      authProvider: 'email_magic_link',
      client: { platform: detectClientPlatform() },
    }),
  })
}

export const getGuardianStatus = (): Promise<GuardianLinkResponse> =>
  jsonRequest('/v1/me/guardian-link', { headers: studentHeaders() })

export const getCapabilities = (): Promise<CapabilityResponse> =>
  jsonRequest('/v1/me/capabilities', { headers: studentHeaders() })

export const createTrialAttempt = (): Promise<TrialAttemptResponse> =>
  jsonRequest('/v1/trial-attempts', { method: 'POST', headers: studentHeaders() })

export const submitTrialAnswer = (attemptId: string, answer: TrialAnswerRequest): Promise<TrialAnswerResponse> =>
  jsonRequest(`/v1/trial-attempts/${attemptId}/answers`, {
    method: 'POST',
    headers: { ...studentHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(answer),
  })
