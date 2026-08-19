import type {
  StudentOnboardingResponse,
  TrialAnswerRequest,
  TrialAnswerResponse,
  TrialAttemptResponse,
} from '@peraquest/contracts'

type ClientPlatform = 'ios' | 'android' | 'pc'

function detectClientPlatform(): ClientPlatform {
  if (/Android/i.test(navigator.userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios'
  return 'pc'
}

export class ApiError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

async function parseError(response: Response, fallback: string): Promise<never> {
  let code = fallback
  try {
    const body = await response.json() as { error?: string; code?: string }
    code = body.code ?? body.error ?? fallback
  } catch {
    // Keep the stable fallback when an upstream error is not JSON.
  }
  throw new ApiError(code)
}

export async function createStudentOnboarding(birthMonth: string): Promise<StudentOnboardingResponse> {
  const response = await fetch('/v1/students/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      birthMonth,
      targetExam: 'eiken_grade_3',
      authProvider: 'email_magic_link',
      client: { platform: detectClientPlatform() },
    }),
  })
  if (!response.ok) return parseError(response, 'ONBOARDING_FAILED')
  return response.json() as Promise<StudentOnboardingResponse>
}

export async function createTrialAttempt(studentId: string): Promise<TrialAttemptResponse> {
  const response = await fetch('/v1/trial-attempts', {
    method: 'POST',
    headers: { 'x-student-id': studentId },
  })
  if (!response.ok) return parseError(response, 'TRIAL_START_FAILED')
  return response.json() as Promise<TrialAttemptResponse>
}

export async function submitTrialAnswer(
  studentId: string,
  attemptId: string,
  answer: TrialAnswerRequest,
): Promise<TrialAnswerResponse> {
  const response = await fetch(`/v1/trial-attempts/${encodeURIComponent(attemptId)}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-student-id': studentId },
    body: JSON.stringify(answer),
  })
  if (!response.ok) return parseError(response, 'TRIAL_ANSWER_FAILED')
  return response.json() as Promise<TrialAnswerResponse>
}
