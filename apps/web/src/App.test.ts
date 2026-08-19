// @vitest-environment happy-dom
import type { CapabilityResponse, TrialQuestion } from '@peraquest/contracts'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import TrialLesson from './components/TrialLesson.vue'

const question: TrialQuestion = {
  id: 'q1', ability: 'grammar', prompt: 'I ___ soccer.', support: 'テスト', choices: ['play', 'plays'],
}

const restrictedCapabilities: CapabilityResponse = {
  examLevel: 'eiken_grade_3', platform: 'pc', canLearn: false, canUploadVoice: false,
  voiceUploadMode: 'disabled', canPurchase: false, guardianLinkStatus: 'pending',
  voiceConsentStatus: 'missing', consentVersionRequired: 'v1', paymentChannels: ['web_checkout'],
  notificationChannels: ['web_push', 'line'], lineReturnTargets: ['web_https'], entitlements: [],
}

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 503, json: async () => body } as Response
}

function installHappyPathFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/v1/students/onboarding') return response({ studentId: 'student-test', isMinor: true, guardianLinkStatus: 'pending', onboardingStatus: 'pending_guardian' })
    if (url === '/v1/me/guardian-link') return response({ status: 'pending', purchaseAllowed: false, verifiedAt: null })
    if (url === '/v1/me/capabilities') return response(restrictedCapabilities)
    if (url === '/v1/me/trial-sessions') return response({ sessionId: 'trial-test', questions: [question] })
    if (url.endsWith('/answers')) return response({ correct: true, correctAnswer: 'play', explanation: 'I には play を使います。', answeredCount: 1 })
    if (url.endsWith('/complete')) return response({ score: 1, total: 1, durableProgressWritten: false })
    return response({}, false)
  }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  sessionStorage.setItem('lingoquest.student.id', 'student-test')
  installHappyPathFetch()
})

describe('minor onboarding vertical slice', () => {
  it('requires a valid birth month before continuing', async () => {
    const wrapper = mount(BirthMonthForm)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('正しい生年月')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.get('input').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([['2012-04']])
  })

  it('keeps restricted capabilities visible and disables a redeemed trial', () => {
    const wrapper = mount(GuardianWait, { props: { trialRedeemed: true, trialPending: false, trialError: '' } })
    expect(wrapper.text()).toContain('音声アップロード・購入・長期学習記録は利用できません')
    expect(wrapper.get('[data-testid="start-trial"]').attributes('disabled')).toBeDefined()
  })

  it('uses the answer and completion APIs', async () => {
    const wrapper = mount(TrialLesson, { props: { questions: [question], sessionId: 'trial-test' } })
    await wrapper.get('input[value="play"]').setValue(true)
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="status"]').text()).toContain('正解！'))
    await wrapper.get('[data-testid="next-question"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('complete')).toEqual([[1]]))
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/v1/me/trial-sessions/trial-test/answers', expect.objectContaining({ method: 'POST' }))
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/v1/me/trial-sessions/trial-test/complete', expect.objectContaining({ method: 'POST' }))
  })

  it('loads guardian status, capabilities, and the real trial session', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('保護者の方との'))
    expect(sessionStorage.getItem('lingoquest.student.id')).toBe('student-test')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/v1/me/guardian-link', expect.anything())
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/v1/me/capabilities', expect.anything())
    await wrapper.get('[data-testid="start-trial"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('英検3級 · おためし'))
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/v1/me/trial-sessions', expect.objectContaining({ method: 'POST' }))
  })

  it('fails closed when guardian or capability policy cannot be loaded', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === '/v1/students/onboarding') return response({ studentId: 'student-test', isMinor: true, guardianLinkStatus: 'pending', onboardingStatus: 'pending_guardian' })
      return response({}, false)
    })
    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('安全設定を確認できませんでした'))
    expect(wrapper.find('[data-testid="start-trial"]').exists()).toBe(false)
  })

  it('keeps the selected answer when the answer service fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({}, false))
    const wrapper = mount(TrialLesson, { props: { questions: [question], sessionId: 'trial-test' } })
    await wrapper.get('input[value="play"]').setValue(true)
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('回答はそのまま'))
    expect((wrapper.get('input[value="play"]').element as HTMLInputElement).checked).toBe(true)
  })
})
