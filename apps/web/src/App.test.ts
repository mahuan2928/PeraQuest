// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import TrialLesson from './components/TrialLesson.vue'
import type { TrialQuestion } from '@peraquest/contracts'

const question: TrialQuestion = {
  id: 'test', ability: 'grammar', prompt: 'I ___ soccer.', support: 'テスト', choices: ['play', 'plays'],
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/v1/students/onboarding')) return { ok: true, json: async () => ({ studentId: 'student-test', isMinor: true, guardianLinkStatus: 'pending', onboardingStatus: 'pending_guardian' }) } as Response
    if (url.endsWith('/v1/trial-attempts')) return { ok: true, json: async () => ({ attemptId: 'attempt-1', questionCount: 1, question, expiresAt: '2099-01-01T00:00:00Z', progressPersisted: false }) } as Response
    return { ok: true, json: async () => ({ correct: true, correctAnswer: 'play', explanation: 'I には play を使います。', completed: true, nextQuestion: null, score: 1, progressPersisted: false }) } as Response
  }))
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

  it('keeps restricted capabilities visible and disables a server-redeemed trial', () => {
    const wrapper = mount(GuardianWait, { props: { trialRedeemed: true } })
    expect(wrapper.text()).toContain('音声アップロード・購入・長期学習記録は利用できません')
    expect(wrapper.get('[data-testid="start-trial"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('このアカウント')
  })

  it('submits answers to the server and announces feedback', async () => {
    const wrapper = mount(TrialLesson, { props: { studentId: 'student-test', attemptId: 'attempt-1', questionCount: 1, firstQuestion: question } })
    await wrapper.get('input[value="play"]').setValue(true)
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="status"]').text()).toContain('正解！'))
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/v1/trial-attempts/attempt-1/answers', expect.any(Object))
    await wrapper.get('[data-testid="next-question"]').trigger('click')
    expect(wrapper.emitted('complete')).toEqual([[1]])
  })

  it('runs onboarding and starts the server-authorized trial without localStorage authority', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('保護者の方との'))
    expect(sessionStorage.getItem('lingoquest.student.id')).toBe('student-test')
    await wrapper.get('[data-testid="start-trial"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('英検3級 · おためし'))
    expect(localStorage.length).toBe(0)
  })

  it('fails closed when onboarding policy cannot be loaded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'ONBOARDING_FAILED' }) } as Response)
    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('安全設定を確認できませんでした'))
    expect(wrapper.find('[data-testid="start-trial"]').exists()).toBe(false)
  })
})
