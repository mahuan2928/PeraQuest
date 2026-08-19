import type {
  CapabilityResponse,
  GuardianLinkResponse,
  StudentOnboardingResponse,
  TrialAnswerRequest,
  TrialAnswerResponse,
  TrialCompleteResponse,
  TrialSessionResponse,
} from '@peraquest/contracts'
import type { RuntimePlatform } from '@peraquest/platform'

function studentHeaders(): HeadersInit {
  const studentId = sessionStorage.getItem('lingoquest.student.id')
  if (!studentId) throw new Error('STUDENT_SESSION_MISSING')
  return { 'x-student-id': studentId, 'x-client-platform': detectClientPlatform() }
}

function detectRuntime(): RuntimePlatform {
  if (/Android/i.test(navigator.userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios'
  return 'web'
}

function detectClientPlatform(): 'ios' | 'android' | 'pc' {
  const runtime = detectRuntime()
  return runtime === 'ios' || runtime === 'android' ? runtime : 'pc'
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const error = new Error(`REQUEST_FAILED_${response.status}`)
    Object.assign(error, { status: response.status })
    throw error
  }
  return response.json() as Promise<T>
}

export async function createStudentOnboarding(birthMonth: string): Promise<StudentOnboardingResponse> {
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

export const createTrialSession = (): Promise<TrialSessionResponse> =>
  jsonRequest('/v1/me/trial-sessions', { method: 'POST', headers: studentHeaders() })

export const submitTrialAnswer = (sessionId: string, answer: TrialAnswerRequest): Promise<TrialAnswerResponse> =>
  jsonRequest(`/v1/me/trial-sessions/${sessionId}/answers`, {
    method: 'POST', headers: { ...studentHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(answer),
  })

export const completeTrialSession = (sessionId: string): Promise<TrialCompleteResponse> =>
  jsonRequest(`/v1/me/trial-sessions/${sessionId}/complete`, { method: 'POST', headers: studentHeaders() })
