import { buildApiUrl } from './onboarding'

export interface ApiDemoCheckpoint {
  endpoint: string
  result: string
  status: number
  body: unknown
}

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
}

export interface DemoRuntime {
  session?: DemoSessionResponse
  invitation?: GuardianInvitationResponse
}

async function requestJson<T>(path: string, init: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(buildApiUrl(path), init)
  const body = await response.json() as T
  if (!response.ok) throw new Error(`LIVE_DEMO_REQUEST_FAILED_${response.status}`)
  return { status: response.status, body }
}

const bearerHeaders = (token: string, extra?: HeadersInit): HeadersInit => ({
  authorization: `Bearer ${token}`,
  ...extra,
})

export const summarizeUploadTicket = (body: unknown): unknown => {
  if (!body || typeof body !== 'object') return body
  const ticket = body as { fields?: Record<string, string>; objectKey?: string }
  return {
    ...ticket,
    objectKey: ticket.objectKey ? '<object key omitted>' : undefined,
    fields: ticket.fields ? {
      ...ticket.fields,
      key: '<object key omitted>',
      policy: '<base64 policy omitted>',
      'x-amz-credential': '<credential omitted>',
      'x-amz-signature': '<signature omitted>',
    } : undefined,
  }
}

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

export async function runLiveApiDemo(onCheckpoint: (checkpoint: ApiDemoCheckpoint) => void): Promise<void> {
  const session = await createDemoSession()

  const before = await fetchDemoCapabilities(session.body.studentToken)
  onCheckpoint({ endpoint: 'GET /v1/me/capabilities', result: 'voiceUploadMode: disabled', status: before.status, body: before.body })

  const invitation = await createDemoGuardianInvitation(session.body.studentToken)
  onCheckpoint({ endpoint: 'POST /v1/me/guardian-link/invitations', result: 'inviteCode + expiresAt', status: invitation.status, body: { ...invitation.body, inviteCode: '<invite code omitted>' } })

  const verification = await verifyDemoGuardian(session.body.guardianToken, invitation.body.inviteCode)
  onCheckpoint({ endpoint: 'PUT /v1/guardian-links/verification', result: 'guardianLinkStatus: verified', status: verification.status, body: verification.body })

  const granted = await setDemoVoiceConsent(session.body.guardianToken, session.body.studentId, 'granted')
  onCheckpoint({ endpoint: 'PUT /v1/guardian-links/{studentId}/consents/voice-processing', result: 'voiceConsentStatus: granted', status: granted.status, body: granted.body })

  const ticket = await createDemoVoiceUploadTicket(session.body.studentToken)
  onCheckpoint({ endpoint: 'POST /v1/me/voice-upload-ticket', result: 'voiceUploadMode: signed_upload', status: ticket.status, body: summarizeUploadTicket(ticket.body) })

  const device = await registerDemoDevice(session.body.studentToken)
  onCheckpoint({ endpoint: 'PUT /v1/me/devices/current', result: 'pushEnabled: false', status: device.status, body: device.body })

  const withdrawn = await setDemoVoiceConsent(session.body.guardianToken, session.body.studentId, 'withdrawn')
  onCheckpoint({ endpoint: 'PUT /v1/guardian-links/{studentId}/consents/voice-processing', result: 'deletionJob: pending', status: withdrawn.status, body: withdrawn.body })
}
