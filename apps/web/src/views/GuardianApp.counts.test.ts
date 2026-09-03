// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GuardianApp from './GuardianApp.vue'

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response
}

const knowledgeItem = (state: string, ref: string, leech = false) => ({
  knowledgePointRef: ref, masteryScore: 0.9, state, dueAt: '2026-09-10T00:00:00.000Z', leech,
})

function mountGuardian(knowledgeItems: ReturnType<typeof knowledgeItem>[]) {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)))
  return mount(GuardianApp, {
    props: {
      session: { studentId: 'student-1', studentToken: 's', guardianToken: 'g', expiresAt: '2026-08-31T12:10:00.000Z' },
      invitationCode: 'invite-code',
      capabilities: { canUploadVoice: false, guardianLinkStatus: 'verified', voiceConsentStatus: 'missing' },
      knowledgeItems,
      reportRefreshKey: 0,
      studentJourneySummary: null,
    },
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('what the guardian headline counts', () => {
  it('does not drop when a mastered point goes stale and reads back as review', async () => {
    // 証拠が古くなると、読み取り時に習得は復習へ落ちます。習得だけを数えると、
    // 誰も何も答えていない週に見出しの数字が減ります。
    const before = mountGuardian([knowledgeItem('mastered', 'grammar.article'), knowledgeItem('mastered', 'grammar.word_order')])
    await flushPromises()
    expect(before.text()).toContain('学習が定着してきた項目')
    const after = mountGuardian([knowledgeItem('review', 'grammar.article'), knowledgeItem('mastered', 'grammar.word_order')])
    await flushPromises()
    const count = (wrapper: typeof before) => wrapper.get('.mini-mastery strong').text()
    expect(count(after)).toBe(count(before))
  })

  it('shows the drop where it can be explained: on the item itself', async () => {
    const wrapper = mountGuardian([knowledgeItem('review', 'grammar.article')])
    await flushPromises()
    expect(wrapper.text()).toContain('復習しましょう')
    expect(wrapper.text()).not.toContain('%')
  })

  it('says a stuck point needs reteaching rather than more drilling', async () => {
    const wrapper = mountGuardian([knowledgeItem('learning', 'grammar.article', true)])
    await flushPromises()
    expect(wrapper.text()).toContain('教え直しが必要です')
    expect(wrapper.text()).toContain('出題をいったん止めています')
  })
})
