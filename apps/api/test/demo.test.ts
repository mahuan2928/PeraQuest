import { describe, expect, it } from 'vitest'
import { runApiDemo } from '../src/demo.js'

describe('API demo script', () => {
  it('runs the guardian voice upload and withdrawal demo flow', async () => {
    const lines: string[] = []
    await runApiDemo((message) => lines.push(message))
    const output = lines.join('\n')
    expect(output).toContain('Minor creates guardian invitation')
    expect(output).toContain('"voiceUploadMode": "signed_upload"')
    expect(output).toContain('Minor requests constrained voice upload ticket')
    expect(output).toContain('"policy": "<base64 policy omitted>"')
    expect(output).toContain('Guardian withdraws voice consent')
    expect(output).toContain('"reason": "voice_consent_withdrawn"')
  })
})
