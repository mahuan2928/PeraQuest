// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import TrialLesson from './components/TrialLesson.vue'
import type { TrialQuestion } from './domain/trial'
import { TRIAL_REDEEMED_KEY } from './domain/trial'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      studentId: 'student-test',
      isMinor: true,
      guardianLinkStatus: 'pending',
      onboardingStatus: 'pending_guardian',
    }),
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

  it('keeps restricted capabilities visible and disables a redeemed trial', () => {
    const wrapper = mount(GuardianWait, { props: { trialRedeemed: true } })
    expect(wrapper.text()).toContain('音声アップロード・購入・長期学習記録は利用できません')
    expect(wrapper.get('[data-testid="start-trial"]').attributes('disabled')).toBeDefined()
  })

  it('announces answer feedback and completes a trial lesson', async () => {
    const question: TrialQuestion = {
      id: 'test', ability: 'grammar', prompt: 'I ___ soccer.', support: 'テスト',
      choices: ['play', 'plays'], answer: 'play', explanation: 'I には play を使います。',
    }
    const wrapper = mount(TrialLesson, { props: { questions: [question] } })
    await wrapper.get('input[value="play"]').setValue(true)
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')
    expect(wrapper.get('[role="status"]').text()).toContain('正解！')
    await wrapper.get('[data-testid="next-question"]').trigger('click')
    expect(wrapper.emitted('complete')).toEqual([[1]])
  })

  it('runs minor onboarding to guardian wait and opens one trial', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('保護者の方との'))
    expect(sessionStorage.getItem('lingoquest.student.id')).toBe('student-test')
    await wrapper.get('[data-testid="start-trial"]').trigger('click')
    expect(wrapper.text()).toContain('英検3級 · おためし')
    expect(localStorage.getItem(TRIAL_REDEEMED_KEY)).toBeNull()
  })

  it('fails closed when onboarding policy cannot be loaded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response)
    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('安全設定を確認できませんでした'))
    expect(wrapper.find('[data-testid="start-trial"]').exists()).toBe(false)
  })
})
