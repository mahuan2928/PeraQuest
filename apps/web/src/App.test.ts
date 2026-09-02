// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import type { TrialQuestion } from '@peraquest/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import BirthMonthForm from './components/BirthMonthForm.vue'
import GuardianWait from './components/GuardianWait.vue'
import KnowledgeMastery from './components/KnowledgeMastery.vue'
import TrialLesson from './components/TrialLesson.vue'
import StudentApp from './views/StudentApp.vue'
import GuardianApp from './views/GuardianApp.vue'

const firstQuestion: TrialQuestion = {
  id: 'q1',
  ability: 'grammar',
  prompt: 'I ___ soccer.',
  support: 'テスト',
  choices: ['play', 'plays'],
}
const secondQuestion: TrialQuestion = {
  id: 'q2',
  ability: 'vocabulary',
  prompt: '「図書館」に合う英語は？',
  support: '場所を表す単語です。',
  choices: ['library', 'station'],
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function installSuccessfulApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/v1/students/onboarding') {
      return jsonResponse({
        studentId: 'student-test',
        isMinor: true,
        guardianLinkStatus: 'pending',
        onboardingStatus: 'pending_guardian',
      }, 201)
    }
    if (url === '/v1/me/guardian-link') {
      return jsonResponse({ status: 'pending', purchaseAllowed: false, verifiedAt: null })
    }
    if (url === '/v1/me/capabilities') {
      return jsonResponse({
        guardianLinkStatus: 'pending',
        canLearn: false,
        canUploadVoice: false,
        canPurchase: false,
      })
    }
    if (url === '/v1/trial-attempts') {
      return jsonResponse({
        attemptId: 'attempt-test',
        questionCount: 2,
        question: firstQuestion,
        expiresAt: '2026-08-19T14:00:00.000Z',
        progressPersisted: false,
      }, 201)
    }
    throw new Error(`Unexpected request: ${url}`)
  }))
}

function installActiveApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/v1/students/onboarding') {
      return jsonResponse({
        studentId: 'student-active',
        isMinor: false,
        guardianLinkStatus: 'not_required',
        onboardingStatus: 'active',
      }, 201)
    }
    if (url === '/v1/me/guardian-link') {
      return jsonResponse({ status: 'not_required', purchaseAllowed: true, verifiedAt: null })
    }
    if (url === '/v1/me/capabilities') {
      return jsonResponse({
        guardianLinkStatus: 'not_required',
        canLearn: true,
        canUploadVoice: true,
        canPurchase: true,
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('minor onboarding vertical slice', () => {
  it('marks the header home link as a dedicated touch target', () => {
    const wrapper = mount(App)
    expect(wrapper.get('header a[aria-label="LingoQuest JP ホーム"]').classes()).toContain('home-link')
  })

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
    const wrapper = mount(GuardianWait, { props: { trialRedeemed: true, trialStatus: 'expired', trialError: 'このアカウントのおためしクエストは利用済みか、有効期限が切れています。' } })
    expect(wrapper.text()).toContain('音声アップロード・購入・長期学習記録は利用できません')
    expect(wrapper.text()).toContain('利用済みか、有効期限が切れています')
    expect(wrapper.get('[data-testid="start-trial"]').attributes('disabled')).toBeDefined()
  })

  it('announces trial loading and prevents duplicate starts', () => {
    const wrapper = mount(GuardianWait, { props: { trialRedeemed: false, trialPending: true, trialStatus: 'loading' } })
    expect(wrapper.get('[data-testid="start-trial"]').text()).toContain('確認中')
    expect(wrapper.get('[data-testid="start-trial"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="status"]').text()).toContain('安全な接続を確認しています')
  })

  it('keeps retry available after a transient trial error', () => {
    const wrapper = mount(GuardianWait, { props: { trialRedeemed: false, trialStatus: 'error', trialError: '接続エラー' } })
    expect(wrapper.get('[data-testid="start-trial"]').text()).toContain('もう一度試す')
    expect(wrapper.get('[data-testid="start-trial"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('接続エラー')
  })

  it('stops retries on the same attempt after a structured 410 expiry', async () => {
    sessionStorage.setItem('lingoquest.student.id', 'student-test')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 'TRIAL_ATTEMPT_EXPIRED' }, 410))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TrialLesson, {
      props: { attemptId: 'expired-attempt', initialQuestion: firstQuestion, questionCount: 2 },
    })

    await wrapper.get('input[value="play"]').setValue(true)
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('expired')).toEqual([[]]))
    expect(wrapper.get('[data-testid="submit-answer"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses server questions and submits answers in order', async () => {
    sessionStorage.setItem('lingoquest.student.id', 'student-test')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        correct: true,
        correctAnswer: 'play',
        explanation: 'I には play を使います。',
        completed: false,
        nextQuestion: secondQuestion,
        score: null,
        progressPersisted: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        correct: true,
        correctAnswer: 'library',
        explanation: 'library は図書館です。',
        completed: true,
        nextQuestion: null,
        score: 2,
        progressPersisted: false,
      }))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(TrialLesson, {
      props: { attemptId: 'attempt-test', initialQuestion: firstQuestion, questionCount: 2 },
    })
    await wrapper.get('input[value="play"]').setValue(true)
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="status"]').text()).toContain('正解！'))
    await wrapper.get('[data-testid="next-question"]').trigger('click')
    expect(wrapper.text()).toContain(secondQuestion.prompt)

    await wrapper.get('input[value="library"]').setValue(true)
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="next-question"]').text()).toContain('結果を見る'))
    await wrapper.get('[data-testid="next-question"]').trigger('click')

    expect(wrapper.emitted('complete')).toEqual([[2]])
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/v1/trial-attempts/attempt-test/answers', expect.objectContaining({
      body: JSON.stringify({ questionId: 'q1', answer: 'play' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/v1/trial-attempts/attempt-test/answers', expect.objectContaining({
      body: JSON.stringify({ questionId: 'q2', answer: 'library' }),
    }))
  })

  it('loads access policy and starts a server-authorized trial', async () => {
    installSuccessfulApi()
    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('保護者の方との'))
    expect(sessionStorage.getItem('lingoquest.student.id')).toBe('student-test')

    await wrapper.get('[data-testid="start-trial"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain(firstQuestion.prompt))
    expect(localStorage.length).toBe(0)
  })

  it('switches to the knowledge mastery page for an active learner', async () => {
    installActiveApi()
    const wrapper = mount(App)

    expect(wrapper.find('[data-testid="birth-month"]').exists()).toBe(true)
    await wrapper.get('[data-testid="birth-month"]').setValue('2000-04')
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => expect(wrapper.get('#mastery-title').text()).toBe('知識マップ'))
    expect(wrapper.text()).toContain('全体の掌握度')
    expect(wrapper.get('[data-testid="mastery-demo-notice"]').text()).toContain('実際の学習データではありません')
    expect(wrapper.find('[data-testid="birth-month"]').exists()).toBe(false)
  })

  it('starts the product demo from the welcome page and switches roles', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        studentId: 'student-1',
        studentToken: 'student-token',
        guardianToken: 'guardian-token',
        expiresAt: '2026-08-31T12:10:00.000Z',
      }, 201))
      .mockResolvedValueOnce(jsonResponse({ canLearn: false, canUploadVoice: false, guardianLinkStatus: 'pending', voiceConsentStatus: 'missing', entitlements: [] }))
      .mockResolvedValueOnce(jsonResponse({ studentId: 'student-1', totalXp: 0, activityCoins: 0, questChapter: 0, questStep: 0, badges: [], updatedAt: '2026-08-31T12:00:00.000Z' })))
    const wrapper = mount(App)

    await wrapper.get('[data-testid="start-product-demo"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('今日の学習を始めます'))

    expect(wrapper.text()).toContain('生徒として体験')
    expect(wrapper.text()).toContain('保護者として体験')
    expect(wrapper.text()).toContain('Quest Map')
    expect(wrapper.text()).toContain('はじまりの港')
    expect(wrapper.text()).toContain('Chapter 1')
    expect(wrapper.text()).toContain('はじまりの島')
    expect(wrapper.text()).toContain('Chapter 2')
    expect(wrapper.text()).toContain('復習の森')
    expect(wrapper.text()).toContain('Chapter 3')
    expect(wrapper.text()).toContain('リスニング入り江')
    expect(wrapper.text()).toContain('現在の目標')
    expect(wrapper.text()).toContain('次の目標')
    expect(wrapper.text()).toContain('スポット詳細')
    expect(wrapper.text()).toContain('冒険バッグ')
    expect(wrapper.text()).toContain('XP クリスタル')
    expect(wrapper.text()).toContain('冒険コイン')
    expect(wrapper.text()).toContain('次に集めるもの')
    expect(wrapper.text()).toContain('LQ')
    expect(wrapper.text()).not.toContain('HTTP')
    expect(wrapper.text()).not.toContain('token')

    await wrapper.get('nav button:nth-child(2)').trigger('click')
    expect(wrapper.text()).toContain('お子さまの学習を見守ります')
  })

  it('shows the student journey summary in the guardian report', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/v1/guardian-links/student-1/student-knowledge') return jsonResponse({ items: [] })
      if (url === '/v1/guardian-links/student-1/learning-summary') {
        return jsonResponse({
          studentId: 'student-1',
          generatedAt: '2026-08-31T12:00:00.000Z',
          overview: {
            headline: '今日の学習で、冒険が前に進みました。',
            weeklyActivityLabel: '6項目の学習記録が更新されています。',
            averageMasteryPercent: 100,
            reviewItemCount: 0,
            masteredItemCount: 6,
          },
          strengths: [],
          reviewFocus: [],
          quest: {
            totalXp: 135,
            activityCoins: 55,
            questChapter: 1,
            questStep: 4,
            badges: ['guardian_shield', 'level_check_cleared', 'review_forest_cleared'],
            summary: 'Quest Map が次の島まで進みました。',
          },
          nextRecommendation: '次は、リスニング入り江の1問体験に進みましょう。',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
    const wrapper = mount(GuardianApp, {
      props: {
        session: {
          studentId: 'student-1',
          studentToken: 'student-token',
          guardianToken: 'guardian-token',
          expiresAt: '2026-08-31T12:10:00.000Z',
        },
        invitationCode: 'invite-code',
        capabilities: { canUploadVoice: false, guardianLinkStatus: 'verified', voiceConsentStatus: 'missing' },
        knowledgeItems: [],
        reportRefreshKey: 0,
        studentJourneySummary: {
          completedQuestCount: 4,
          totalQuestCount: 5,
          totalXp: 145,
          activityCoins: 58,
          masteryAverage: 100,
          highlights: [
            '保護者確認が完了しました',
            'レベルチェックを完了しました',
            '復習の森をクリアしました',
            'リスニング入り江を体験しました',
          ],
          badges: ['guardian_shield', 'level_check_cleared', 'review_forest_cleared', 'listening_cove_trial'],
          nextStep: '次は、リスニング入り江の本編公開に向けて短い会話を続けましょう。',
        },
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('お子さまの冒険まとめ'))
    expect(wrapper.text()).toContain('4 / 5')
    expect(wrapper.text()).toContain('145')
    expect(wrapper.text()).toContain('58')
    expect(wrapper.text()).toContain('リスニング入り江を体験しました')
    expect(wrapper.text()).toContain('リスニング入り江体験')
    expect(wrapper.text()).toContain('次は、リスニング入り江の本編公開に向けて短い会話を続けましょう。')
  })

  it('shows and dismisses a reward celebration from game-state progress after the level check', async () => {
    let gameStateCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/me/game-state') {
        gameStateCalls += 1
        if (gameStateCalls === 1) {
          return jsonResponse({ studentId: 'student-1', totalXp: 0, activityCoins: 0, questChapter: 0, questStep: 2, badges: ['guardian_shield'], updatedAt: '2026-08-31T12:00:00.000Z' })
        }
        return jsonResponse({ studentId: 'student-1', totalXp: 60, activityCoins: 20, questChapter: 0, questStep: 3, badges: ['guardian_shield', 'level_check_challenger'], updatedAt: '2026-08-31T12:01:00.000Z' })
      }
      if (url.includes('/api/v1/stage-exams/') && url.endsWith('/attempts')) {
        return jsonResponse({
          attemptId: 'attempt-1',
          items: [{
            itemId: 'item-1',
            prompt: 'Yesterday, I ___ my homework.',
            support: '最も自然な過去形を選んでください。',
            options: [{ optionId: 'option-1', text: 'finished' }],
          }],
        }, 201)
      }
      if (url === '/api/v1/stage-attempts/attempt-1/submit') return jsonResponse({ accepted: true })
      if (url === '/api/v1/stage-attempts/attempt-1/result') {
        return jsonResponse({
          passed: false,
          score: 0.5,
          maxScore: 1,
        })
      }
      if (url === '/api/v1/student-knowledge') return jsonResponse({ items: [] })
      throw new Error(`Unexpected request: ${url}`)
    }))
    const wrapper = mount(StudentApp, {
      props: {
        session: {
          studentId: 'student-1',
          studentToken: 'student-token',
          guardianToken: 'guardian-token',
          expiresAt: '2026-08-31T12:10:00.000Z',
        },
        capabilities: { canLearn: true, canUploadVoice: false, guardianLinkStatus: 'verified', voiceConsentStatus: 'missing' },
        invitationCode: '',
        knowledgeItems: [],
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('Quest Map'))
    await wrapper.get('.lesson-panel .primary-action').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Yesterday, I ___ my homework.'))
    await wrapper.get('input[value="option-1"]').setValue(true)
    await wrapper.get('.question-card .primary-action').trigger('click')

    await vi.waitFor(() => expect(wrapper.text()).toContain('報酬を獲得しました'))
    expect(wrapper.text()).toContain('+60 XP')
    expect(wrapper.text()).toContain('+20 コイン')
    expect(wrapper.text()).toContain('Quest チャレンジャー')
    expect(wrapper.text()).toContain('60 XP を集めました。')
    expect(wrapper.text()).toContain('20 コインを持っています。')

    await wrapper.get('.reward-close').trigger('click')
    expect(wrapper.text()).not.toContain('報酬を獲得しました')
  })

  it('opens a review quest from the review forest after level check progress', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/me/game-state') {
        return jsonResponse({ studentId: 'student-1', totalXp: 60, activityCoins: 20, questChapter: 0, questStep: 3, badges: ['guardian_shield', 'level_check_challenger'], updatedAt: '2026-08-31T12:01:00.000Z' })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
    const wrapper = mount(StudentApp, {
      props: {
        session: {
          studentId: 'student-1',
          studentToken: 'student-token',
          guardianToken: 'guardian-token',
          expiresAt: '2026-08-31T12:10:00.000Z',
        },
        capabilities: { canLearn: true, canUploadVoice: false, guardianLinkStatus: 'verified', voiceConsentStatus: 'missing' },
        invitationCode: '',
        knowledgeItems: [
          { knowledgePointRef: 'grammar.past_tense', masteryScore: 0.25, state: 'due', dueAt: null },
          { knowledgePointRef: 'vocabulary.context', masteryScore: 0.5, state: 'learning', dueAt: null },
          { knowledgePointRef: 'reading.reason', masteryScore: 0.75, state: 'mastered', dueAt: null },
        ],
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('復習クエストを始めます'))
    expect(wrapper.text()).toContain('今日の復習クエスト')
    expect(wrapper.text()).toContain('過去形')
    expect(wrapper.text()).toContain('文脈から語彙を選ぶ力')

    await wrapper.get('.review-route + .primary-action').trigger('click')
    expect(wrapper.text()).toContain('森のルート')
    expect(wrapper.text()).toContain('3つのポイントを確認中')
    expect(wrapper.text()).toContain('例文を声に出して読みました')
    expect(wrapper.text()).toContain('今日いちばん復習したいポイント')
    expect(wrapper.text()).toContain('短い英文を1つ書き直しました')
    expect(wrapper.text()).toContain('0 / 3 タスク完了')
    expect(wrapper.get('.review-quest-panel .secondary-action').attributes('disabled')).toBeDefined()

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('input[name="review-focus"][value="grammar.past_tense"]').setValue(true)
    await wrapper.get('.review-rewrite-input').setValue('I finished my homework.')
    expect(wrapper.text()).toContain('3 / 3 タスク完了')
    await wrapper.get('.review-quest-panel .secondary-action').trigger('click')
    expect(wrapper.text()).toContain('今日の復習を完了しました')
    await vi.waitFor(() => expect(wrapper.text()).toContain('4 / 5 スポット達成'))
    expect(wrapper.text()).toContain('今日の冒険まとめ')
    expect(wrapper.text()).toContain('レベルチェックを完了しました')
    expect(wrapper.text()).toContain('復習の森をクリアしました')
    expect(wrapper.text()).toContain('+15 XP')
    expect(wrapper.text()).toContain('+5 コイン')
    expect(wrapper.text()).toContain('復習の森クリア')
    expect(wrapper.text()).toContain('次の冒険は準備中です')

    await wrapper.findAll('button').find((button) => button.text().includes('次の島をプレビューします'))!.trigger('click')
    expect(wrapper.text()).toContain('リスニング入り江')
    expect(wrapper.text()).toContain('短い会話を聞き取り、時間・理由・気持ちを選ぶ新しい冒険です。')
    expect(wrapper.text()).toContain('保護者レポートに次のおすすめとして表示予定')
    expect(wrapper.text()).toContain('Chapter 3')

    await wrapper.findAll('button').find((button) => button.text().includes('1問だけ体験します'))!.trigger('click')
    expect(wrapper.text()).toContain('どこで会いますか？')
    expect(wrapper.text()).toContain("Let's meet at the library after school.")
    await wrapper.get('input[value="library"]').setValue(true)
    await wrapper.findAll('button').find((button) => button.text().includes('答えを確認します'))!.trigger('click')
    expect(wrapper.text()).toContain('正解です。library は「図書館」です。')
    expect(wrapper.text()).toContain('+10 XP')
    expect(wrapper.text()).toContain('+3 コイン')
    expect(wrapper.text()).toContain('リスニング入り江体験')
    expect(wrapper.text()).toContain('85 XP を集めました。')
    expect(wrapper.text()).toContain('28 コインを持っています。')
    expect(wrapper.text()).toContain('リスニング入り江を体験しました')
    expect(wrapper.text()).toContain('次は、リスニング入り江の本編公開に向けて短い会話を続けましょう。')
    expect(wrapper.findAll('button').some((button) => button.text().includes('体験済みです'))).toBe(true)
  })

  it('keeps demo practice unavailable without emitting or calling an API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(KnowledgeMastery)
    const buttons = wrapper.findAll('[data-testid="practice-unavailable"]')

    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.text()).toContain('体験表示では利用できません')

    const firstButton = buttons.at(0)
    expect(firstButton).toBeDefined()
    await firstButton!.trigger('click')
    expect(wrapper.emitted('practice')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an expired answer attempt to GuardianWait without starting a second trial', async () => {
    installSuccessfulApi()
    const fetchMock = vi.mocked(fetch)
    const baseImplementation = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/answers')) return jsonResponse({ code: 'TRIAL_ATTEMPT_EXPIRED' }, 410)
      return baseImplementation(input, init)
    })

    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="start-trial"]').exists()).toBe(true))
    await wrapper.get('[data-testid="start-trial"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain(firstQuestion.prompt))
    await wrapper.get('input[value="play"]').setValue(true)
    await wrapper.get('[data-testid="submit-answer"]').trigger('click')

    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('有効期限が切れました'))
    expect(wrapper.get('[data-testid="start-trial"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('新しいおためしは開始せず、保護者の方に連携')
    expect(wrapper.text()).not.toContain(firstQuestion.prompt)
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/v1/trial-attempts')).toHaveLength(1)
  })

  it('fails closed when onboarding policy cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)))
    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('安全設定を確認できませんでした'))
    expect(wrapper.find('[data-testid="start-trial"]').exists()).toBe(false)
  })

  it('blocks conservatively when the trial service rejects the attempt', async () => {
    installSuccessfulApi()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementationOnce(fetchMock.getMockImplementation()!)
    const baseImplementation = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/v1/trial-attempts') return jsonResponse({ code: 'TRIAL_ALREADY_REDEEMED' }, 409)
      return baseImplementation(input, init)
    })

    const wrapper = mount(App)
    await wrapper.get('[data-testid="birth-month"]').setValue('2012-04')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="start-trial"]').exists()).toBe(true))
    await wrapper.get('[data-testid="start-trial"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('利用済みか、有効期限が切れています'))
    expect(wrapper.get('[data-testid="start-trial"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain(firstQuestion.prompt)
  })
})
