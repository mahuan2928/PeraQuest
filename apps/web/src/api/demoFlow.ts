import { buildApiUrl } from './onboarding'

export interface ApiDemoCheckpoint {
  endpoint: string
  result: string
  status: number
  body: unknown
}

interface DemoSessionResponse {
  studentId: string
  studentToken: string
  guardianToken: string
  expiresAt: string
}

interface GuardianInvitationResponse {
  inviteCode: string
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

const summarizeUploadTicket = (body: unknown): unknown => {
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

export async function runLiveApiDemo(onCheckpoint: (checkpoint: ApiDemoCheckpoint) => void): Promise<void> {
  const session = await requestJson<DemoSessionResponse>('/v1/demo/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: 'minor_guardian_voice' }),
  })

  const before = await requestJson('/v1/me/capabilities', {
    headers: bearerHeaders(session.body.studentToken, { 'x-client-platform': 'pc' }),
  })
  onCheckpoint({ endpoint: 'GET /v1/me/capabilities', result: 'voiceUploadMode: disabled', status: before.status, body: before.body })

  const invitation = await requestJson<GuardianInvitationResponse>('/v1/me/guardian-link/invitations', {
    method: 'POST',
    headers: bearerHeaders(session.body.studentToken),
  })
  onCheckpoint({ endpoint: 'POST /v1/me/guardian-link/invitations', result: 'inviteCode + expiresAt', status: invitation.status, body: { ...invitation.body, inviteCode: '<invite code omitted>' } })

  const verification = await requestJson('/v1/guardian-links/verification', {
    method: 'PUT',
    headers: bearerHeaders(session.body.guardianToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({ inviteCode: invitation.body.inviteCode }),
  })
  onCheckpoint({ endpoint: 'PUT /v1/guardian-links/verification', result: 'guardianLinkStatus: verified', status: verification.status, body: verification.body })

  const granted = await requestJson(`/v1/guardian-links/${session.body.studentId}/consents/voice-processing`, {
    method: 'PUT',
    headers: bearerHeaders(session.body.guardianToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({ status: 'granted', version: 'v1' }),
  })
  onCheckpoint({ endpoint: 'PUT /v1/guardian-links/{studentId}/consents/voice-processing', result: 'voiceConsentStatus: granted', status: granted.status, body: granted.body })

  const ticket = await requestJson('/v1/me/voice-upload-ticket', {
    method: 'POST',
    headers: bearerHeaders(session.body.studentToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      contentType: 'audio/webm',
      contentLengthBytes: 4096,
      durationSeconds: 30,
      checksumSha256: 'a'.repeat(64),
    }),
  })
  onCheckpoint({ endpoint: 'POST /v1/me/voice-upload-ticket', result: 'voiceUploadMode: signed_upload', status: ticket.status, body: summarizeUploadTicket(ticket.body) })

  const device = await requestJson('/v1/me/devices/current', {
    method: 'PUT',
    headers: bearerHeaders(session.body.studentToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({ platform: 'ios', deviceId: 'web-live-demo-device', appVersion: '1.0.0', osVersion: '17.5' }),
  })
  onCheckpoint({ endpoint: 'PUT /v1/me/devices/current', result: 'pushEnabled: false', status: device.status, body: device.body })

  const withdrawn = await requestJson(`/v1/guardian-links/${session.body.studentId}/consents/voice-processing`, {
    method: 'PUT',
    headers: bearerHeaders(session.body.guardianToken, { 'content-type': 'application/json' }),
    body: JSON.stringify({ status: 'withdrawn', version: 'v1' }),
  })
  onCheckpoint({ endpoint: 'PUT /v1/guardian-links/{studentId}/consents/voice-processing', result: 'deletionJob: pending', status: withdrawn.status, body: withdrawn.body })
}
