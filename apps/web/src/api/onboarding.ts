type ClientPlatform = 'ios' | 'android' | 'pc'

export interface OnboardingResponse {
  studentId: string
  isMinor: boolean
  guardianLinkStatus: 'not_required' | 'pending' | 'verified' | 'rejected' | 'revoked'
  onboardingStatus: 'pending_guardian' | 'active'
}

function detectClientPlatform(): ClientPlatform {
  if (/Android/i.test(navigator.userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios'
  return 'pc'
}

export async function createStudentOnboarding(birthMonth: string): Promise<OnboardingResponse> {
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

  if (!response.ok) throw new Error('ONBOARDING_FAILED')
  return response.json() as Promise<OnboardingResponse>
}
