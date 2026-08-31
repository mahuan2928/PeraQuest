<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  createDemoGuardianInvitation,
  createDemoSession,
  createDemoVoiceUploadTicket,
  fetchDemoCapabilities,
  registerDemoDevice,
  setDemoVoiceConsent,
  summarizeUploadTicket,
  verifyDemoGuardian,
  type ApiDemoCheckpoint,
  type DemoRuntime,
} from '../api/demoFlow'

interface DemoStep {
  id: string
  actor: 'student' | 'guardian' | 'payment' | 'learning' | 'game' | 'system'
  title: string
  endpoint: string
  story: string
  cta: string
  complete: string
  result: string
}

const demoSteps: DemoStep[] = [
  {
    id: 'student-entry',
    actor: 'student',
    title: '学生进入 Demo',
    endpoint: 'POST /v1/demo/session + GET /v1/me/capabilities',
    story: '未成年学生打开体验页，系统创建短期 demo 身份，并先检查当前可用能力。',
    cta: '进入学生体验',
    complete: '学生已进入，语音上传暂未开放',
    result: 'voiceUploadMode: disabled',
  },
  {
    id: 'plan-selected',
    actor: 'student',
    title: '学生选择学习套餐',
    endpoint: 'MOCK /checkout/plan-selection',
    story: '学生选择 EIKEN Grade 3 月度练习套餐，页面生成一笔 mock checkout order。',
    cta: '选择学习套餐',
    complete: '套餐已选择，等待家长支付',
    result: 'plan: eiken_grade_3_monthly',
  },
  {
    id: 'invitation',
    actor: 'student',
    title: '学生邀请监护人',
    endpoint: 'POST /v1/me/guardian-link/invitations',
    story: '学生点击邀请监护人，生成一次性邀请，并交给监护人完成确认。',
    cta: '生成监护人邀请',
    complete: '邀请已生成，等待监护人确认',
    result: 'inviteCode + expiresAt',
  },
  {
    id: 'verification',
    actor: 'guardian',
    title: '监护人确认关系',
    endpoint: 'PUT /v1/guardian-links/verification',
    story: '监护人打开邀请，提交邀请码，后端将 guardian link 标记为 verified。',
    cta: '监护人确认',
    complete: '监护人关系已确认',
    result: 'guardianLinkStatus: verified',
  },
  {
    id: 'consent-granted',
    actor: 'guardian',
    title: '监护人授权语音处理',
    endpoint: 'PUT /v1/guardian-links/{studentId}/consents/voice-processing',
    story: '只有已验证的监护人可以为未成年学生开启语音处理同意。',
    cta: '同意语音处理',
    complete: '语音处理已授权',
    result: 'voiceConsentStatus: granted',
  },
  {
    id: 'payment-approved',
    actor: 'guardian',
    title: '家长确认并支付',
    endpoint: 'MOCK /guardian/checkout/approve',
    story: '家长看到订单、学生信息和授权说明后，使用 mock card 完成支付确认。',
    cta: '家长 mock 支付',
    complete: '支付已完成，等待权益生效',
    result: 'paymentStatus: paid',
  },
  {
    id: 'entitlement-activated',
    actor: 'payment',
    title: '支付回调开通权益',
    endpoint: 'MOCK payment.webhook.subscription_activated',
    story: 'mock 支付回调把订阅状态改成 active，学生解锁正式练习和语音能力。',
    cta: '触发支付回调',
    complete: '订阅权益已开通',
    result: 'entitlementStatus: active',
  },
  {
    id: 'diagnostic-test',
    actor: 'learning',
    title: '学生开始水平测试',
    endpoint: 'MOCK /learning/diagnostic-attempts',
    story: '学生进入正式学习后先做 3 道诊断题，系统判断当前薄弱点和推荐起点。',
    cta: '开始水平测试',
    complete: '测试完成，定位到语法和词汇薄弱点',
    result: 'diagnosticScore: 2/3',
  },
  {
    id: 'lesson-session',
    actor: 'learning',
    title: '学生进入学习任务',
    endpoint: 'MOCK /learning/lesson-sessions',
    story: '系统根据诊断结果生成今日学习任务，学生完成语法讲解、例题和即时反馈。',
    cta: '开始今日学习',
    complete: '今日学习完成，掌握度已提升',
    result: 'lessonStatus: completed',
  },
  {
    id: 'signed-upload',
    actor: 'student',
    title: '学生上传语音',
    endpoint: 'POST /v1/me/voice-upload-ticket',
    story: '学生回到练习页，系统刷新能力并申请受限制的签名上传票据。',
    cta: '模拟上传语音',
    complete: '上传票据已签发，语音可提交',
    result: 'voiceUploadMode: signed_upload',
  },
  {
    id: 'review-session',
    actor: 'learning',
    title: '学生完成复习任务',
    endpoint: 'MOCK /learning/review-sessions',
    story: '系统把错题知识点放入复习队列，学生完成间隔复习并生成下次复习时间。',
    cta: '开始今日复习',
    complete: '复习完成，薄弱点进入明日队列',
    result: 'reviewQueue: updated',
  },
  {
    id: 'game-reward',
    actor: 'game',
    title: '游戏化奖励结算',
    endpoint: 'MOCK /game/reward-ledger',
    story: '完成测试、学习和复习后，系统发放 XP、金币和地图进度，形成继续学习的反馈。',
    cta: '领取游戏奖励',
    complete: '奖励已领取，地图进度推进',
    result: 'xpGained: 120',
  },
  {
    id: 'guardian-report',
    actor: 'guardian',
    title: '家长查看学习报告',
    endpoint: 'MOCK /guardian/reports/daily-summary',
    story: '家长端看到支付状态、今日学习完成度、薄弱点、复习计划和游戏奖励摘要。',
    cta: '查看家长报告',
    complete: '家长报告已生成',
    result: 'reportStatus: ready',
  },
  {
    id: 'device',
    actor: 'student',
    title: '学生注册设备',
    endpoint: 'PUT /v1/me/devices/current',
    story: '学生设备完成登记，demo 只记录设备 metadata 和 hash，不接收真实 push token。',
    cta: '登记当前设备',
    complete: '设备已登记，push 保持关闭',
    result: 'pushEnabled: false',
  },
  {
    id: 'withdrawal',
    actor: 'guardian',
    title: '监护人撤回授权',
    endpoint: 'PUT /v1/guardian-links/{studentId}/consents/voice-processing',
    story: '监护人撤回语音处理同意，系统关闭学生语音能力并创建删除任务脚手架。',
    cta: '撤回语音授权',
    complete: '授权已撤回，语音能力关闭',
    result: 'deletionJob: pending',
  },
]

const completedCount = ref(0)
const checkpoints = ref<ApiDemoCheckpoint[]>([])
const running = ref(false)
const error = ref('')
const runtime = ref<DemoRuntime>({})
const mockOrder = ref<{ id: string; plan: string; amount: string; status: 'draft' | 'paid' | 'active' } | null>(null)
const learningSummary = ref({ score: '未开始', mastery: '未开始', review: '未开始' })
const gameSummary = ref({ level: 1, xp: 0, coins: 0, streak: 0 })
const liveMode = import.meta.env.VITE_API_DEMO_MODE === 'live'
const hasRun = computed(() => completedCount.value === demoSteps.length)
const activeStep = computed(() => hasRun.value ? demoSteps[demoSteps.length - 1] : demoSteps[completedCount.value])
const checkpointOutput = computed(() => checkpoints.value.length > 0
  ? checkpoints.value
  : demoSteps.slice(0, completedCount.value).map((step) => ({ endpoint: step.endpoint, result: step.result })))
const maskedInviteCode = computed(() => runtime.value.invitation?.inviteCode ? '•••• ••••' : '未生成')
const sessionExpiry = computed(() => runtime.value.session?.expiresAt ?? '未创建')
const selectedPlan = computed(() => mockOrder.value ? `${mockOrder.value.plan} / ${mockOrder.value.amount}` : '未选择')
const progressPercent = computed(() => `${Math.round((completedCount.value / demoSteps.length) * 100)}%`)
const completedStepIds = computed(() => new Set(demoSteps.slice(0, completedCount.value).map((step) => step.id)))
const isStepComplete = (stepId: string) => completedStepIds.value.has(stepId)
const studentVoiceStatus = computed(() => {
  if (isStepComplete('withdrawal')) return '已关闭'
  if (isStepComplete('signed-upload')) return '可上传'
  return '等待监护人授权'
})
const guardianStatus = computed(() => {
  if (isStepComplete('withdrawal')) return '已撤回'
  if (isStepComplete('consent-granted')) return '已授权'
  if (isStepComplete('verification')) return '已验证'
  return '待确认'
})
const paymentStatus = computed(() => {
  if (isStepComplete('entitlement-activated')) return '权益已开通'
  if (isStepComplete('payment-approved')) return '已支付'
  if (isStepComplete('plan-selected')) return '待家长支付'
  return '未开始'
})
const learningStatus = computed(() => {
  if (isStepComplete('review-session')) return '复习完成'
  if (isStepComplete('lesson-session')) return '学习完成'
  if (isStepComplete('diagnostic-test')) return '测试完成'
  return '未开始'
})
const gameStatus = computed(() => isStepComplete('game-reward') ? `Lv.${gameSummary.value.level} / ${gameSummary.value.xp} XP` : '待解锁')

function getStaticBody(step: DemoStep): unknown {
  if (step.id === 'student-entry') {
    runtime.value.session = {
      studentId: 'student-live-demo',
      studentToken: 'static-student-token',
      guardianToken: 'static-guardian-token',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }
    return {
      session: { studentId: runtime.value.session.studentId, expiresAt: runtime.value.session.expiresAt, tokens: '<omitted>' },
      capabilities: { voiceUploadMode: 'disabled' },
    }
  }
  if (step.id === 'plan-selected') {
    mockOrder.value = { id: 'mock-order-20260831', plan: 'EIKEN Grade 3 Monthly', amount: '¥1,980', status: 'draft' }
    return { orderId: mockOrder.value.id, plan: mockOrder.value.plan, amount: mockOrder.value.amount, paymentStatus: 'requires_guardian_approval' }
  }
  if (step.id === 'invitation') {
    runtime.value.invitation = { inviteCode: 'static-invite-code', expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }
    return { inviteCode: '<invite code omitted>', expiresAt: runtime.value.invitation.expiresAt }
  }
  if (step.id === 'verification') return { guardianLinkStatus: 'verified' }
  if (step.id === 'consent-granted') return { voiceConsentStatus: 'granted' }
  if (step.id === 'payment-approved') {
    mockOrder.value = { ...(mockOrder.value ?? { id: 'mock-order-20260831', plan: 'EIKEN Grade 3 Monthly', amount: '¥1,980', status: 'draft' }), status: 'paid' }
    return { orderId: mockOrder.value.id, paymentStatus: 'paid', card: 'mock_4242', provider: 'mock' }
  }
  if (step.id === 'entitlement-activated') {
    mockOrder.value = { ...(mockOrder.value ?? { id: 'mock-order-20260831', plan: 'EIKEN Grade 3 Monthly', amount: '¥1,980', status: 'paid' }), status: 'active' }
    return { subscriptionStatus: 'active', entitlement: 'premium_practice', source: 'mock_payment_webhook' }
  }
  if (step.id === 'diagnostic-test') {
    learningSummary.value = { ...learningSummary.value, score: '2/3' }
    return {
      diagnosticScore: '2/3',
      recommendedLevel: 'EIKEN Grade 3',
      weakPoints: ['past tense', 'word choice'],
      nextAction: 'lesson-session',
    }
  }
  if (step.id === 'lesson-session') {
    learningSummary.value = { ...learningSummary.value, mastery: '62% -> 76%' }
    return {
      lessonStatus: 'completed',
      cardsCompleted: 6,
      masteryDelta: '+14%',
      unlockedSkill: 'grammar_past_tense',
    }
  }
  if (step.id === 'signed-upload') return { voiceUploadMode: 'signed_upload', upload: 'simulated' }
  if (step.id === 'review-session') {
    learningSummary.value = { ...learningSummary.value, review: '明日 3 个知识点' }
    return {
      reviewQueue: 'updated',
      dueTomorrow: ['past tense', 'word choice', 'speaking fluency'],
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }
  }
  if (step.id === 'game-reward') {
    gameSummary.value = { level: 2, xp: 120, coins: 45, streak: 1 }
    return {
      xpGained: 120,
      coinsGained: 45,
      streakDays: 1,
      mapNodeUnlocked: 'Forest Gate',
      avatarItem: 'Bronze Compass',
    }
  }
  if (step.id === 'guardian-report') {
    return {
      reportStatus: 'ready',
      paidPlan: mockOrder.value?.plan ?? 'EIKEN Grade 3 Monthly',
      today: { diagnosticScore: learningSummary.value.score, masteryDelta: learningSummary.value.mastery, xp: gameSummary.value.xp },
      parentMessage: '今天完成测试、学习和复习，建议明天继续复习 past tense。',
    }
  }
  if (step.id === 'device') return { pushEnabled: false, deviceRegistered: true }
  return { voiceConsentStatus: 'withdrawn', deletionJob: 'pending' }
}

function appendCheckpoint(step: DemoStep, status: number, body: unknown) {
  checkpoints.value.push({
    endpoint: step.endpoint,
    result: step.result,
    status,
    body,
  })
  completedCount.value = checkpoints.value.length
}

function requireSession() {
  if (!runtime.value.session) throw new Error('DEMO_SESSION_MISSING')
  return runtime.value.session
}

function requireInvitation() {
  if (!runtime.value.invitation) throw new Error('DEMO_INVITATION_MISSING')
  return runtime.value.invitation
}

async function runLiveStep(step: DemoStep) {
  if (step.endpoint.startsWith('MOCK ')) {
    appendCheckpoint(step, 200, getStaticBody(step))
    return
  }

  if (step.id === 'student-entry') {
    const session = await createDemoSession()
    runtime.value.session = session.body
    const capabilities = await fetchDemoCapabilities(session.body.studentToken)
    appendCheckpoint(step, capabilities.status, {
      session: { studentId: session.body.studentId, expiresAt: session.body.expiresAt, tokens: '<omitted>' },
      capabilities: capabilities.body,
    })
    return
  }

  const session = requireSession()
  if (step.id === 'invitation') {
    const invitation = await createDemoGuardianInvitation(session.studentToken)
    runtime.value.invitation = invitation.body
    appendCheckpoint(step, invitation.status, { ...invitation.body, inviteCode: '<invite code omitted>' })
    return
  }
  if (step.id === 'verification') {
    const verification = await verifyDemoGuardian(session.guardianToken, requireInvitation().inviteCode)
    appendCheckpoint(step, verification.status, verification.body)
    return
  }
  if (step.id === 'consent-granted') {
    const granted = await setDemoVoiceConsent(session.guardianToken, session.studentId, 'granted')
    appendCheckpoint(step, granted.status, granted.body)
    return
  }
  if (step.id === 'signed-upload') {
    await fetchDemoCapabilities(session.studentToken)
    const ticket = await createDemoVoiceUploadTicket(session.studentToken)
    appendCheckpoint(step, ticket.status, summarizeUploadTicket(ticket.body))
    return
  }
  if (step.id === 'device') {
    const device = await registerDemoDevice(session.studentToken)
    appendCheckpoint(step, device.status, device.body)
    return
  }
  const withdrawn = await setDemoVoiceConsent(session.guardianToken, session.studentId, 'withdrawn')
  appendCheckpoint(step, withdrawn.status, withdrawn.body)
}

async function runNextStep() {
  if (running.value) return
  const step = activeStep.value
  if (!step || hasRun.value) return
  error.value = ''
  running.value = true
  try {
    if (liveMode) {
      await runLiveStep(step)
    } else {
      appendCheckpoint(step, 200, getStaticBody(step))
    }
  } catch {
    error.value = '这一步没有跑通。请确认 API server 已启用 DEMO_API_ENABLED=true、DEMO_SESSION_SECRET，并配置 demo storage settings。'
  } finally {
    running.value = false
  }
}

async function runDemo() {
  if (running.value) return
  resetDemo()
  if (!liveMode) {
    demoSteps.forEach((step) => appendCheckpoint(step, 200, getStaticBody(step)))
    return
  }
  for (const step of demoSteps) {
    await runNextStep()
    if (error.value) break
  }
}

function resetDemo() {
  completedCount.value = 0
  checkpoints.value = []
  error.value = ''
  runtime.value = {}
  mockOrder.value = null
  learningSummary.value = { score: '未开始', mastery: '未开始', review: '未开始' }
  gameSummary.value = { level: 1, xp: 0, coins: 0, streak: 0 }
}
</script>

<template>
  <section
    class="api-demo-panel"
    aria-labelledby="api-demo-title"
  >
    <header class="api-demo-hero">
      <div>
        <p class="eyebrow">
          LIVE PAGE DEMO
        </p>
        <h1 id="api-demo-title">
          学生、家长、支付、学习到游戏化复习的全流程 Demo
        </h1>
        <p class="api-demo-lead">
          用可见页面完整走一遍业务流程：学生选套餐、邀请家长、mock 支付、权益开通、开始测试、学习、语音练习、复习、游戏奖励和家长报告。
        </p>
      </div>
      <div
        class="api-demo-scorecard"
        aria-label="Demo progress"
      >
        <strong>{{ completedCount }}/{{ demoSteps.length }}</strong>
        <span>closed-loop steps</span>
      </div>
    </header>

    <div class="api-demo-progress" aria-hidden="true">
      <span :style="{ width: progressPercent }" />
    </div>

    <div class="api-demo-personas">
      <article class="api-demo-persona">
        <span>学生</span>
        <strong>{{ studentVoiceStatus }}</strong>
        <small>Session expires: {{ sessionExpiry }}</small>
      </article>
      <article class="api-demo-persona api-demo-persona--guardian">
        <span>监护人</span>
        <strong>{{ guardianStatus }}</strong>
        <small>Invite code: {{ maskedInviteCode }}</small>
      </article>
      <article class="api-demo-persona api-demo-persona--payment">
        <span>支付 / 权益</span>
        <strong>{{ paymentStatus }}</strong>
        <small>Plan: {{ selectedPlan }}</small>
      </article>
      <article class="api-demo-persona api-demo-persona--learning">
        <span>测试 / 学习 / 复习</span>
        <strong>{{ learningStatus }}</strong>
        <small>Score {{ learningSummary.score }} · Mastery {{ learningSummary.mastery }}</small>
      </article>
      <article class="api-demo-persona api-demo-persona--game">
        <span>游戏化</span>
        <strong>{{ gameStatus }}</strong>
        <small>Coins {{ gameSummary.coins }} · Streak {{ gameSummary.streak }} day</small>
      </article>
    </div>

    <section
      v-if="activeStep"
      class="api-demo-experience"
      aria-label="User-facing demo experience"
    >
      <article class="demo-device demo-device--student">
        <header>
          <span>Student App</span>
          <strong>PeraQuest</strong>
        </header>

        <div v-if="activeStep.id === 'student-entry'" class="demo-screen">
          <p class="demo-kicker">Welcome</p>
          <h2>今日の冒険をはじめよう</h2>
          <p>英検3級に向けた学習体験を開始します。未成年アカウントなので、購入と音声機能は家長確認後に開きます。</p>
        </div>
        <div v-else-if="activeStep.id === 'plan-selected'" class="demo-screen">
          <p class="demo-kicker">Plan</p>
          <h2>EIKEN Grade 3 Monthly</h2>
          <p>毎日の診断、レッスン、復習、音声練習、ゲーム報酬をまとめて体験できます。</p>
          <strong class="demo-price">¥1,980 / month</strong>
        </div>
        <div v-else-if="activeStep.id === 'invitation'" class="demo-screen">
          <p class="demo-kicker">Guardian Invite</p>
          <h2>家長に確認をお願いしよう</h2>
          <p>招待コードを発行して、家長 App に送ります。</p>
          <span class="demo-code">{{ maskedInviteCode }}</span>
        </div>
        <div v-else-if="activeStep.id === 'diagnostic-test'" class="demo-screen demo-quiz">
          <p class="demo-kicker">Placement Test</p>
          <h2>Choose the best answer</h2>
          <p>Yesterday, I ___ my homework before dinner.</p>
          <button type="button">finish</button>
          <button type="button" class="selected">finished</button>
          <button type="button">finishing</button>
        </div>
        <div v-else-if="activeStep.id === 'lesson-session'" class="demo-screen">
          <p class="demo-kicker">Lesson</p>
          <h2>Past tense mini lesson</h2>
          <p>弱点だった過去形を、例文カードと即時フィードバックで復習します。</p>
          <div class="demo-meter"><span style="width: 76%" /></div>
          <small>Mastery 62% → 76%</small>
        </div>
        <div v-else-if="activeStep.id === 'signed-upload'" class="demo-screen">
          <p class="demo-kicker">Speaking Practice</p>
          <h2>Read aloud challenge</h2>
          <p>音声処理の同意があるので、発音練習を提出できます。</p>
          <div class="demo-wave"><span /><span /><span /><span /></div>
        </div>
        <div v-else-if="activeStep.id === 'review-session'" class="demo-screen">
          <p class="demo-kicker">Review</p>
          <h2>今日の復習 3 件</h2>
          <p>past tense、word choice、speaking fluency を明日の復習キューに入れます。</p>
        </div>
        <div v-else-if="activeStep.id === 'game-reward'" class="demo-screen demo-reward">
          <p class="demo-kicker">Reward</p>
          <h2>Forest Gate unlocked</h2>
          <p>120 XP、45 coins、Bronze Compass を獲得しました。</p>
        </div>
        <div v-else class="demo-screen">
          <p class="demo-kicker">{{ activeStep.actor }}</p>
          <h2>{{ hasRun ? '今日の冒険が完了しました' : activeStep.title }}</h2>
          <p>{{ hasRun ? '学習、復習、ゲーム報酬、家長レポートまで完了しています。' : activeStep.story }}</p>
        </div>
      </article>

      <article class="demo-device demo-device--guardian">
        <header>
          <span>Guardian App</span>
          <strong>Parent View</strong>
        </header>
        <div v-if="['verification', 'consent-granted', 'payment-approved'].includes(activeStep.id)" class="demo-screen">
          <p class="demo-kicker">Approval</p>
          <h2>{{ activeStep.title }}</h2>
          <p>{{ activeStep.story }}</p>
          <strong>{{ selectedPlan }}</strong>
        </div>
        <div v-else-if="activeStep.id === 'entitlement-activated'" class="demo-screen">
          <p class="demo-kicker">Subscription</p>
          <h2>Premium practice is active</h2>
          <p>支払い完了後、学生の診断テストと学習タスクが解放されました。</p>
        </div>
        <div v-else-if="activeStep.id === 'guardian-report'" class="demo-screen">
          <p class="demo-kicker">Daily Report</p>
          <h2>今日の学習レポート</h2>
          <p>診断 {{ learningSummary.score }}、掌握度 {{ learningSummary.mastery }}、報酬 {{ gameSummary.xp }} XP。</p>
          <small>明日は past tense を復習しましょう。</small>
        </div>
        <div v-else-if="activeStep.id === 'withdrawal'" class="demo-screen">
          <p class="demo-kicker">Privacy</p>
          <h2>音声処理同意を撤回</h2>
          <p>撤回後、学生の音声アップロードは閉じられ、削除ジョブが作成されます。</p>
        </div>
        <div v-else class="demo-screen">
          <p class="demo-kicker">Waiting</p>
          <h2>家長確認待ち</h2>
          <p>学生が選んだプラン、招待、学習状況がここに表示されます。</p>
          <small>Status: {{ guardianStatus }} / {{ paymentStatus }}</small>
        </div>
      </article>
    </section>

    <div class="api-demo-actions">
      <button
        class="primary-action api-demo-run"
        type="button"
        :disabled="running || hasRun"
        data-testid="run-next-api-demo-step"
        @click="runNextStep"
      >
        {{ running ? '处理中...' : hasRun ? '今日体验已完成' : activeStep?.cta }}
      </button>
      <button
        class="api-demo-secondary"
        type="button"
        :disabled="running || hasRun"
        data-testid="run-api-demo-flow"
        @click="runDemo"
      >
        自动体验完整 Demo
      </button>
      <button
        class="api-demo-reset"
        type="button"
        :disabled="running || completedCount === 0"
        data-testid="reset-api-demo-flow"
        @click="resetDemo"
      >
        重新体验
      </button>
    </div>

    <p
      class="api-demo-status"
      role="status"
      aria-live="polite"
      data-testid="api-demo-status"
    >
      {{ running ? '正在推进当前业务步骤...' : hasRun ? '全流程页面 Demo 已完成：选课、家长、mock 支付、权益、测试、学习、复习、游戏、报告、撤回都已走通。' : liveMode ? 'Live mode enabled. 现有后端步骤会调用真实 demo API，支付、学习、复习和游戏步骤为前端 mock。' : '静态演示模式：无需后端即可走完整页面闭环。' }}
    </p>
    <p
      v-if="error"
      class="api-demo-error"
      role="alert"
      data-testid="api-demo-error"
    >
      {{ error }}
    </p>

    <section
      class="api-demo-product"
      aria-label="Visible product demo state"
      data-testid="api-demo-product-state"
    >
      <article>
        <span>诊断测试</span>
        <strong>{{ learningSummary.score }}</strong>
        <p>3 道 mock placement 题定位起点：EIKEN Grade 3。</p>
      </article>
      <article>
        <span>学习任务</span>
        <strong>{{ learningSummary.mastery }}</strong>
        <p>语法讲解、例题、即时反馈组成今日 lesson session。</p>
      </article>
      <article>
        <span>复习队列</span>
        <strong>{{ learningSummary.review }}</strong>
        <p>错题知识点进入 spaced review，生成明日复习计划。</p>
      </article>
      <article>
        <span>游戏奖励</span>
        <strong>{{ gameSummary.xp }} XP</strong>
        <p>金币 {{ gameSummary.coins }}，连胜 {{ gameSummary.streak }} 天，地图节点解锁。</p>
      </article>
    </section>

    <details class="api-demo-events">
      <summary>开发者事件流</summary>
      <ol class="api-demo-timeline">
        <li
          v-for="(step, index) in demoSteps"
          :key="step.id"
          class="api-demo-step"
          :class="{ 'api-demo-step--done': index < completedCount, 'api-demo-step--active': index === completedCount && !hasRun }"
        >
          <span class="api-demo-step__number">{{ index + 1 }}</span>
          <div class="api-demo-step__body">
            <div class="api-demo-step__heading">
              <h2>{{ step.title }}</h2>
              <span class="api-demo-step__actor">{{ step.actor }}</span>
            </div>
            <div class="api-demo-step__heading api-demo-step__heading--endpoint">
              <code>{{ step.endpoint }}</code>
            </div>
            <p>{{ step.story }}</p>
            <strong>{{ index < completedCount ? step.complete : step.result }}</strong>
          </div>
        </li>
      </ol>
    </details>

    <aside
      class="api-demo-boundary"
      aria-labelledby="api-demo-boundary-title"
    >
      <h2 id="api-demo-boundary-title">
        Demo 边界
      </h2>
      <ul>
        <li>家长支付、订单和权益开通在页面内 mock，不依赖真实 payment provider。</li>
        <li>测试、学习、复习、游戏奖励和家长报告是页面内 mock，用于验证产品闭环和演示体验。</li>
        <li>默认静态模式不需要 PostgreSQL、对象存储、voice vendor、payment provider、push provider。</li>
        <li>Live 模式下现有 guardian/voice/device 步骤会调用后端，产品学习链路仍保持 mock。</li>
        <li>Live 后端需要开启 <code>DEMO_API_ENABLED=true</code> 和 <code>DEMO_SESSION_SECRET</code>。</li>
        <li>后端 CLI demo 仍可用：<code>npm run demo:api -w @peraquest/api</code>。</li>
      </ul>
    </aside>

    <details class="api-demo-output">
      <summary>技术详情：已完成 API checkpoints</summary>
      <pre data-testid="api-demo-checkpoints">{{ JSON.stringify(checkpointOutput, null, 2) }}</pre>
    </details>
  </section>
</template>

<style scoped>
.api-demo-panel { width: min(980px, 100%); color: var(--ink); }
.api-demo-hero { display: flex; align-items: end; justify-content: space-between; gap: 28px; margin-bottom: 28px; }
.api-demo-hero h1 { max-width: 760px; font-size: clamp(2.35rem, 6vw, 4.9rem); }
.api-demo-lead { max-width: 640px; margin: 18px 0 0; color: #53615c; line-height: 1.7; }
.api-demo-scorecard { display: grid; flex: 0 0 150px; gap: 5px; padding: 16px; border: 2px solid var(--ink); background: var(--lime); box-shadow: 6px 6px 0 var(--ink); transform: rotate(2deg); }
.api-demo-scorecard strong { font-size: 2.45rem; line-height: 1; letter-spacing: -.08em; }
.api-demo-scorecard span { font-size: .72rem; font-weight: 900; text-transform: uppercase; }
.api-demo-progress { height: 12px; margin: 0 0 18px; border: 2px solid var(--ink); background: #eef0e5; box-shadow: 4px 4px 0 var(--ink); }
.api-demo-progress span { display: block; height: 100%; background: var(--green); transition: width .24s ease; }
.api-demo-personas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.api-demo-persona { display: grid; gap: 6px; padding: 16px; border: 2px solid var(--ink); background: var(--paper); box-shadow: 4px 4px 0 var(--ink); }
.api-demo-persona--guardian { background: #fff0e9; }
.api-demo-persona--payment { background: #eef0e5; }
.api-demo-persona--learning { background: #f8f3d4; }
.api-demo-persona--game { background: var(--lime); }
.api-demo-persona span, .api-demo-current__actor, .api-demo-step__actor { color: var(--green); font-size: .72rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.api-demo-persona strong { font-size: 1.25rem; }
.api-demo-persona small { color: #65706c; font-weight: 800; overflow-wrap: anywhere; }
.api-demo-experience { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(280px, .85fr); gap: 18px; margin-bottom: 18px; }
.demo-device { display: grid; gap: 18px; min-height: 360px; padding: 18px; border: 3px solid var(--ink); border-radius: 28px; background: #f7f2df; box-shadow: 7px 7px 0 var(--ink); }
.demo-device--guardian { background: #fff0e9; }
.demo-device header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 2px solid var(--ink); }
.demo-device header span, .demo-kicker { color: var(--green); font-size: .72rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.demo-device header strong { font-size: 1.15rem; }
.demo-screen { display: grid; align-content: center; gap: 14px; min-height: 260px; padding: 22px; border: 2px solid var(--ink); border-radius: 20px; background: var(--paper); }
.demo-screen h2 { margin: 0; font-size: clamp(1.55rem, 4vw, 2.6rem); line-height: 1.05; }
.demo-screen p { margin: 0; color: #53615c; line-height: 1.65; }
.demo-screen small { color: #65706c; font-weight: 800; }
.demo-price, .demo-code { display: inline-block; width: fit-content; padding: 8px 12px; border: 2px solid var(--ink); background: var(--lime); box-shadow: 3px 3px 0 var(--ink); }
.demo-quiz button { min-height: 42px; border: 2px solid var(--line); background: #fff; color: var(--ink); font-weight: 900; text-align: left; }
.demo-quiz .selected { border-color: var(--green); background: var(--lime); }
.demo-meter { height: 14px; border: 2px solid var(--ink); background: #eef0e5; }
.demo-meter span { display: block; height: 100%; background: var(--green); }
.demo-wave { display: flex; align-items: end; gap: 8px; height: 74px; }
.demo-wave span { width: 18px; border: 2px solid var(--ink); background: var(--lime); box-shadow: 2px 2px 0 var(--ink); }
.demo-wave span:nth-child(1) { height: 34px; }
.demo-wave span:nth-child(2) { height: 62px; }
.demo-wave span:nth-child(3) { height: 46px; }
.demo-wave span:nth-child(4) { height: 70px; }
.demo-reward { background: linear-gradient(135deg, var(--paper), var(--lime)); }
.api-demo-current { display: grid; grid-template-columns: 96px 1fr; gap: 18px; margin-bottom: 18px; padding: 20px; border: 2px solid var(--ink); background: var(--lime); box-shadow: 5px 5px 0 var(--ink); }
.api-demo-current h2 { margin: 0 0 8px; font-size: 1.35rem; }
.api-demo-current p { margin: 0 0 12px; color: #36423d; line-height: 1.6; }
.api-demo-current code { display: inline-block; padding: 5px 8px; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font-size: .72rem; font-weight: 900; }
.api-demo-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.api-demo-run { width: auto; min-width: 210px; margin-top: 0; }
.api-demo-secondary, .api-demo-reset { min-height: 54px; padding: 12px 18px; border: 2px solid var(--ink); color: var(--ink); background: var(--paper); font-weight: 900; box-shadow: 4px 4px 0 var(--ink); }
.api-demo-secondary { background: #fff0e9; }
.api-demo-status { margin: 0 0 24px; color: var(--green); font-size: .84rem; font-weight: 900; }
.api-demo-error { margin: -8px 0 24px; color: #a72a13; font-size: .84rem; font-weight: 900; }
.api-demo-product { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.api-demo-product article { display: grid; gap: 8px; padding: 16px; border: 2px solid var(--line); background: rgb(255 253 246 / 72%); }
.api-demo-product span { color: var(--green); font-size: .72rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.api-demo-product strong { font-size: 1.35rem; }
.api-demo-product p { margin: 0; color: #65706c; font-size: .85rem; line-height: 1.5; }
.api-demo-events { margin-bottom: 18px; }
.api-demo-events summary { min-height: 44px; font-weight: 900; cursor: pointer; }
.api-demo-timeline { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; counter-reset: demo-step; }
.api-demo-step { display: grid; grid-template-columns: 48px 1fr; gap: 16px; padding: 18px; border: 2px solid var(--line); background: rgb(255 253 246 / 72%); opacity: .68; }
.api-demo-step--done { border-color: var(--ink); background: var(--paper); opacity: 1; box-shadow: 5px 5px 0 var(--ink); }
.api-demo-step--active { border-color: var(--green); opacity: 1; }
.api-demo-step__number { display: grid; place-items: center; width: 44px; height: 44px; border: 2px solid var(--line); border-radius: 50%; color: #65706c; font-weight: 900; }
.api-demo-step--done .api-demo-step__number { border-color: var(--green); color: white; background: var(--green); }
.api-demo-step__heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.api-demo-step__heading--endpoint { justify-content: start; margin-top: 6px; }
.api-demo-step h2 { margin: 0; font-size: 1.1rem; }
.api-demo-step code, .api-demo-output code, .api-demo-output pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.api-demo-step code { padding: 4px 7px; border: 1px solid var(--line); background: #eef0e5; color: var(--green); font-size: .72rem; font-weight: 800; }
.api-demo-step p { margin: 8px 0 10px; color: #65706c; line-height: 1.55; }
.api-demo-step strong { color: var(--ink); font-size: .86rem; }
.api-demo-boundary { margin-top: 24px; padding: 20px; border: 2px solid var(--ink); background: #fff0e9; box-shadow: 5px 5px 0 var(--ink); }
.api-demo-boundary h2 { margin: 0 0 10px; font-size: 1.1rem; }
.api-demo-boundary ul { display: grid; gap: 8px; margin: 0; padding-left: 20px; color: #53615c; line-height: 1.55; }
.api-demo-boundary code { color: var(--ink); font-weight: 800; }
.api-demo-output { margin-top: 18px; }
.api-demo-output summary { min-height: 44px; font-weight: 900; cursor: pointer; }
.api-demo-output pre { overflow: auto; margin: 8px 0 0; padding: 16px; border: 1px solid var(--line); background: var(--ink); color: var(--paper); font-size: .75rem; line-height: 1.45; }
@media (max-width: 680px) {
  .api-demo-hero { align-items: start; flex-direction: column; }
  .api-demo-scorecard { align-self: end; }
  .api-demo-personas, .api-demo-current, .api-demo-product, .api-demo-experience { grid-template-columns: 1fr; }
  .api-demo-actions { display: grid; }
  .api-demo-run, .api-demo-secondary, .api-demo-reset { width: 100%; }
  .api-demo-step { grid-template-columns: 1fr; }
  .api-demo-step__heading { align-items: stretch; flex-direction: column; }
}
@media (max-width: 360px) {
  .api-demo-scorecard { align-self: stretch; grid-template-columns: auto 1fr; align-items: center; }
  .api-demo-scorecard strong { font-size: 2rem; }
}
@media (prefers-reduced-motion: reduce) {
  .api-demo-scorecard, .api-demo-step, .api-demo-reset, .api-demo-progress span { transform: none; transition: none; }
}
</style>
