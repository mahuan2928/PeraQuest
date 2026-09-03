import { buildApiUrl } from './onboarding'

export interface DemoSessionResponse {
  studentId: string
  studentToken: string
  guardianToken: string
  expiresAt: string
}

export interface GuardianInvitationResponse {
  inviteCode: string
  expiresAt?: string
}

export interface DemoRequestResult<T = unknown> {
  status: number
  body: T
  ok: boolean
}

export interface DemoRuntime {
  session?: DemoSessionResponse
  invitation?: GuardianInvitationResponse
}

async function requestJson<T>(path: string, init: RequestInit): Promise<DemoRequestResult<T>> {
  const response = await fetch(buildApiUrl(path), init)
  const text = await response.text()
  let body: unknown = {}
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { message: text }
    }
  }
  return { status: response.status, body: body as T, ok: response.ok }
}

const bearerHeaders = (token: string, extra?: HeadersInit): HeadersInit => ({
  authorization: `Bearer ${token}`,
  ...extra,
})

export async function createDemoSession(): Promise<DemoRequestResult<DemoSessionResponse>> {
  return requestJson<DemoSessionResponse>('/v1/demo/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: 'minor_guardian_voice' }),
  })
}

export async function fetchDemoCapabilities(studentToken: string): Promise<DemoRequestResult> {
  return requestJson('/v1/me/capabilities', {
    headers: bearerHeaders(studentToken, { 'x-client-platform': 'pc' }),
  })
}

export async function createDemoGuardianInvitation(studentToken: string): Promise<DemoRequestResult<GuardianInvitationResponse>> {
  return requestJson<GuardianInvitationResponse>('/v1/me/guardian-link/invitations', {
    method: 'POST',
    headers: bearerHeaders(studentToken),
  })
}

export async function verifyDemoGuardian(guardianToken: string, inviteCode: string): Promise<DemoRequestResult> {
  return requestJson('/v1/guardian-links/verification', {
    method: 'PUT',
    headers: bearerHeaders(guardianToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({ inviteCode }),
  })
}

export async function setDemoVoiceConsent(
  guardianToken: string,
  studentId: string,
  status: 'granted' | 'withdrawn',
): Promise<DemoRequestResult> {
  return requestJson(`/v1/guardian-links/${studentId}/consents/voice-processing`, {
    method: 'PUT',
    headers: bearerHeaders(guardianToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({ status, version: 'v1' }),
  })
}

export async function startDemoStageAttempt(studentToken: string, stageExamId: string, idempotencyKey: string): Promise<DemoRequestResult> {
  return requestJson(`/api/v1/stage-exams/${stageExamId}/attempts`, {
    method: 'POST',
    headers: bearerHeaders(studentToken, { 'idempotency-key': idempotencyKey }),
  })
}

export async function submitDemoStageAttempt(
  studentToken: string,
  stageAttemptId: string,
  answers: Array<{ itemId: string; selectedOptionId: string | null }>,
  idempotencyKey: string,
): Promise<DemoRequestResult> {
  return requestJson(`/api/v1/stage-attempts/${stageAttemptId}/submit`, {
    method: 'POST',
    headers: bearerHeaders(studentToken, { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }),
    body: JSON.stringify({ answers }),
  })
}

export async function fetchDemoStageAttemptResult(studentToken: string, stageAttemptId: string): Promise<DemoRequestResult> {
  return requestJson(`/api/v1/stage-attempts/${stageAttemptId}/result`, {
    headers: bearerHeaders(studentToken),
  })
}

export async function fetchDemoStudentKnowledge(studentToken: string): Promise<DemoRequestResult> {
  return requestJson('/api/v1/student-knowledge', {
    headers: bearerHeaders(studentToken),
  })
}

export async function fetchDemoGameState(studentToken: string): Promise<DemoRequestResult> {
  return requestJson('/api/v1/me/game-state', {
    headers: bearerHeaders(studentToken),
  })
}

export async function fetchDemoGuardianStudentKnowledge(guardianToken: string, studentId: string): Promise<DemoRequestResult> {
  return requestJson(`/v1/guardian-links/${studentId}/student-knowledge`, {
    headers: bearerHeaders(guardianToken),
  })
}

export async function fetchDemoGuardianLearningSummary(guardianToken: string, studentId: string): Promise<DemoRequestResult> {
  return requestJson(`/v1/guardian-links/${studentId}/learning-summary`, {
    headers: bearerHeaders(guardianToken),
  })
}

export async function createDemoVoiceUploadTicket(studentToken: string): Promise<DemoRequestResult> {
  return requestJson('/v1/me/voice-upload-ticket', {
    method: 'POST',
    headers: bearerHeaders(studentToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      contentType: 'audio/webm',
      contentLengthBytes: 4096,
      durationSeconds: 30,
      checksumSha256: 'a'.repeat(64),
    }),
  })
}

export async function registerDemoDevice(studentToken: string): Promise<DemoRequestResult> {
  return requestJson('/v1/me/devices/current', {
    method: 'PUT',
    headers: bearerHeaders(studentToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({ platform: 'ios', deviceId: 'web-live-demo-device', appVersion: '1.0.0', osVersion: '17.5' }),
  })
}
