import type { Pool } from 'pg'
import { dailyItemKinds } from '@peraquest/contracts'
import { readKnowledgePoints } from './content/knowledgePoints.js'
import type { StudyPlanResponse, CosmeticShopResponse, CosmeticItemDto, CosmeticPurchaseResponse, CosmeticPurchaseOutcome, ExamDateResponse, DailyAnswerResponse, DailyHintResponse, DailyItemDto, DailyItemKind, DailyPlanResponse, DailySessionDto, DailySessionStartResponse, AuthProvider, ClientPlatform, ConsentStatus, CurrentDeviceRegistrationResponse, GameRewardGrantDto, GuardianInvitationResponse, GuardianLinkStatus, GuardianLinkVerificationResponse, KnowledgeEvidenceOutcome, StageAttemptResultResponse, StartStageAttemptResponse, StudentGameStateResponse, StudentKnowledgeProjectionDto, UserRole } from '@peraquest/contracts'
import type { AuthUser, AuthUserResolver } from './auth.js'

export class PostgresAuthUserResolver implements AuthUserResolver {
  constructor(
    private readonly pool: Pool,
    private readonly provider: 'apple' | 'google' | 'email_magic_link',
  ) {}

  async resolve(_issuer: string, providerSubject: string): Promise<AuthUser | null> {
    const result = await this.pool.query<{ id: string; role: UserRole }>(`
      SELECT u.id, u.role
      FROM auth_identities ai
      JOIN users u ON u.id = ai.user_id
      WHERE ai.provider = $1
        AND ai.provider_subject = $2
        AND u.deleted_at IS NULL
      LIMIT 1
    `, [this.provider, providerSubject])
    return result.rows[0] ?? null
  }
}

export interface StudentRecord {
  id: string
  birthMonth: string
  isMinor: boolean
  guardianLinkStatus: GuardianLinkStatus
  guardianId: string | null
}

export interface ConsentRecord {
  status: ConsentStatus
  version: string | null
}

export interface TrialAttemptRecord {
  id: string
  studentId: string
  currentIndex: number
  score: number
  expiresAt: Date
}

export type TrialStartResult = { status: 'created'; attempt: TrialAttemptRecord } | { status: 'redeemed' }
export type CreateStudentWithAuthIdentityResult = { status: 'created' } | { status: 'identity_conflict' }
export type SubscriptionEntitlementStatus = 'active' | 'grace_period' | 'expired' | 'revoked'
export type PaymentWebhookProcessResult = { status: 'processed' } | { status: 'duplicate' } | { status: 'payload_mismatch' } | { status: 'invalid_guardian_link' }
export type StageAttemptStartResult =
  | { status: 'created' | 'replayed'; httpStatus: number; attempt: StartStageAttemptResponse }
  | { status: 'exam_not_available' | 'already_open' | 'request_in_progress' | 'key_reused' }
  | { status: 'cooldown'; daysRemaining: number; sessionsRemaining: number }
export type StageAttemptSubmitResult =
  | { status: 'submitted' | 'replayed'; httpStatus: number; result: StageAttemptResultResponse }
  | { status: 'attempt_not_found' | 'already_finalized' | 'expired' | 'invalid_submission' | 'request_in_progress' | 'key_reused' }

export interface StartStageAttemptInput {
  studentId: string
  stageExamId: string
  attemptId: string
  idempotencyKey: string
  requestHash: Buffer
  actorAuthProvider: AuthProvider
  actorProviderSubject: string
  eventId: string
  requestId: string
}

export interface SubmitStageAttemptAnswerInput {
  itemId: string
  selectedOptionId: string | null
}

export interface SubmitStageAttemptInput {
  studentId: string
  attemptId: string
  idempotencyKey: string
  requestHash: Buffer
  actorAuthProvider: AuthProvider
  actorProviderSubject: string
  eventId: string
  requestId: string
  answers: SubmitStageAttemptAnswerInput[]
}

export interface UpsertCurrentDeviceInput {
  studentId: string
  platform: ClientPlatform
  deviceIdHash: string
  appVersion?: string
  osVersion?: string
  lastSeenAt: Date
}

export interface CreateGuardianInviteInput {
  studentId: string
  inviteCode: string
  inviteCodeHash: string
  expiresAt: Date
  createdAt: Date
}

export interface VerifyGuardianInviteInput {
  guardianId: string
  inviteCodeHash: string
  verifiedAt: Date
}

export interface ProcessPaymentWebhookInput {
  provider: 'web_checkout'
  externalEventId: string
  eventType: string
  payloadHash: string
  studentId: string
  purchaserGuardianId: string
  externalSubscriptionId: string
  entitlementCode: string
  status: SubscriptionEntitlementStatus
  validUntil: Date | null
  receivedAt: Date
}

export interface StudentRepository {
  create(student: StudentRecord): Promise<void>
  createWithAuthIdentity(student: StudentRecord, provider: AuthProvider, providerSubject: string): Promise<CreateStudentWithAuthIdentityResult>
  createDemoGuardian?(guardianId: string): Promise<void>
  createDemoAuthIdentity?(userId: string, provider: AuthProvider, providerSubject: string): Promise<void>
  findById(id: string): Promise<StudentRecord | null>
  createGuardianInvite(input: CreateGuardianInviteInput): Promise<GuardianInvitationResponse | null>
  verifyGuardianInvite(input: VerifyGuardianInviteInput): Promise<GuardianLinkVerificationResponse | null>
  getVoiceConsent(studentId: string, requiredVersion: string): Promise<ConsentRecord>
  setVoiceConsent(studentId: string, guardianId: string | null, status: Exclude<ConsentStatus, 'missing' | 'outdated'>, version: string): Promise<ConsentRecord>
  startTrial(studentId: string, attemptId: string, expiresAt: Date): Promise<TrialStartResult>
  findTrialAttempt(attemptId: string): Promise<TrialAttemptRecord | null>
  advanceTrialAttempt(attemptId: string, expectedIndex: number, correct: boolean): Promise<TrialAttemptRecord | null>
  completeTrialAttempt(attemptId: string): Promise<void>
  startStageAttempt(input: StartStageAttemptInput): Promise<StageAttemptStartResult>
  findStageAttempt(studentId: string, attemptId: string): Promise<StartStageAttemptResponse | null>
  submitStageAttempt(input: SubmitStageAttemptInput): Promise<StageAttemptSubmitResult>
  findStageAttemptResult(studentId: string, attemptId: string): Promise<StageAttemptResultResponse | null>
  listStudentKnowledgeProjections(studentId: string): Promise<StudentKnowledgeProjectionDto[]>
  getStudentGameState(studentId: string): Promise<StudentGameStateResponse>
  listActiveEntitlements(studentId: string, asOf: Date): Promise<string[]>
  getStudyPlan(studentId: string): Promise<StudyPlanResponse>
  getCosmeticShop(studentId: string): Promise<CosmeticShopResponse>
  purchaseCosmetic(studentId: string, code: string): Promise<CosmeticPurchaseResponse>
  equipCosmetic(studentId: string, code: string): Promise<CosmeticPurchaseResponse | null>
  getExamDate(studentId: string): Promise<ExamDateResponse>
  setExamDate(studentId: string, examDate: string | null): Promise<ExamDateResponse | null>
  getDailyPlan(studentId: string): Promise<DailyPlanResponse>
  startDailySession(studentId: string): Promise<DailySessionStartResponse | null>
  getDailyHint(studentId: string, sessionId: string, contentItemId: string): Promise<DailyHintResponse | null>
  submitDailyAnswer(input: { studentId: string; sessionId: string; contentItemId: string; response: string | string[] | null; timedOut: boolean }): Promise<DailyAnswerResponse | null>
  processPaymentWebhook(input: ProcessPaymentWebhookInput): Promise<PaymentWebhookProcessResult>
  upsertCurrentDevice(input: UpsertCurrentDeviceInput): Promise<CurrentDeviceRegistrationResponse>
  disableCurrentDevicePush(input: UpsertCurrentDeviceInput): Promise<CurrentDeviceRegistrationResponse | null>
}

interface StageAttemptHeaderRow extends Record<string, unknown> {
  attempt_id: string
  exam_version_id: string
  status: 'open'
  started_at: Date
  expires_at: Date
  pass_score: string
}

interface StageAttemptItemRow extends Record<string, unknown> {
  item_id: string
  item_ref: string
  ordinal: number
  prompt: string
  support: string | null
  points: string
}

interface StageAttemptOptionRow extends Record<string, unknown> {
  item_id: string
  option_id: string
  text: string
  ordinal: number
}

interface StageAttemptResultHeaderRow extends Record<string, unknown> {
  attempt_id: string
  status: 'passed' | 'failed'
  submitted_at: Date
  raw_score: string
  max_score: string
  score: string
  passed: boolean
  pass_score: string
}

interface StageAttemptResultItemRow extends Record<string, unknown> {
  item_id: string
  outcome: KnowledgeEvidenceOutcome
  earned_score: string
  max_score: string
  prompt: string
  selected_text: string | null
  correct_text: string
}

interface StudentKnowledgeProjectionRow extends Record<string, unknown> {
  student_id: string
  knowledge_point_ref: string
  raw_correct_total: string
  raw_attempt_total: string
  mastery_score: string
  state: StudentKnowledgeProjectionDto['state']
  last_occurred_at: Date
  due_at: Date
  leech: boolean
  updated_at: Date
}

interface StudentGameStateRow extends Record<string, unknown> {
  student_id: string
  total_xp: number
  activity_coins: number
  quest_chapter: number
  quest_step: number
  updated_at: Date
}

interface Queryable {
  query<Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null }>
}

const parseNumeric = (value: string | number): number => typeof value === 'number' ? value : Number.parseFloat(value)

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString()

const readStageAttemptView = async (database: Queryable, studentId: string, attemptId: string): Promise<StartStageAttemptResponse | null> => {
  const headerResult = await database.query<StageAttemptHeaderRow>(`
    SELECT a.id AS attempt_id, a.exam_version_id, a.status, a.started_at, a.expires_at,
           ev.pass_score::text AS pass_score
    FROM stage_attempts a
    JOIN stage_exam_versions ev ON ev.id = a.exam_version_id
    WHERE a.id = $1 AND a.student_id = $2 AND a.status = 'open'
    LIMIT 1
  `, [attemptId, studentId])
  const header = headerResult.rows[0]
  if (!header) return null

  const itemResult = await database.query<StageAttemptItemRow>(`
    SELECT id AS item_id, item_ref, position AS ordinal, prompt, support, max_score::text AS points
    FROM stage_attempt_item_snapshots
    WHERE attempt_id = $1
    ORDER BY position
  `, [attemptId])
  const optionResult = await database.query<StageAttemptOptionRow>(`
    SELECT s.id AS item_id, os.id AS option_id, os.option_text AS text, os.position AS ordinal
    FROM stage_attempt_item_snapshots s
    JOIN stage_attempt_item_option_snapshots os ON os.item_snapshot_id = s.id
    WHERE s.attempt_id = $1
    ORDER BY s.position, os.position
  `, [attemptId])
  const optionsByItem = new Map<string, StageAttemptOptionRow[]>()
  for (const option of optionResult.rows) {
    const options = optionsByItem.get(option.item_id) ?? []
    options.push(option)
    optionsByItem.set(option.item_id, options)
  }

  return {
    attemptId: header.attempt_id,
    examVersionId: header.exam_version_id,
    status: 'open',
    startedAt: toIso(header.started_at),
    expiresAt: toIso(header.expires_at),
    passScore: parseNumeric(header.pass_score),
    items: itemResult.rows.map((item) => ({
      itemId: item.item_id,
      itemRef: item.item_ref,
      ordinal: item.ordinal,
      prompt: item.prompt,
      support: item.support,
      points: parseNumeric(item.points),
      options: (optionsByItem.get(item.item_id) ?? []).map((option) => ({ optionId: option.option_id, text: option.text })),
    })),
  }
}

const readStageAttemptResult = async (database: Queryable, studentId: string, attemptId: string): Promise<StageAttemptResultResponse | null> => {
  const headerResult = await database.query<StageAttemptResultHeaderRow>(`
    SELECT a.id AS attempt_id, a.status, a.submitted_at,
           coalesce(sum(ans.earned_score), 0)::text AS raw_score,
           coalesce(sum(ans.max_score), 0)::text AS max_score,
           a.score::text AS score,
           a.passed,
           ev.pass_score::text AS pass_score
    FROM stage_attempts a
    JOIN stage_exam_versions ev ON ev.id = a.exam_version_id
    LEFT JOIN stage_attempt_answers ans ON ans.attempt_id = a.id
    WHERE a.id = $1 AND a.student_id = $2 AND a.status IN ('passed', 'failed')
    GROUP BY a.id, a.status, a.submitted_at, a.score, a.passed, ev.pass_score
    LIMIT 1
  `, [attemptId, studentId])
  const header = headerResult.rows[0]
  if (!header) return null

  const itemResult = await database.query<StageAttemptResultItemRow>(`
    SELECT ans.item_snapshot_id AS item_id, ans.outcome, ans.earned_score::text, ans.max_score::text,
           item.prompt,
           chosen.option_text AS selected_text,
           correct.option_text AS correct_text
    FROM stage_attempt_answers ans
    JOIN stage_attempt_item_snapshots item ON item.id = ans.item_snapshot_id
    JOIN stage_attempt_answer_key_snapshots keys ON keys.item_snapshot_id = item.id
    JOIN stage_attempt_item_option_snapshots correct ON correct.id = keys.correct_option_snapshot_id
    LEFT JOIN stage_attempt_item_option_snapshots chosen ON chosen.id = ans.selected_option_snapshot_id
    WHERE ans.attempt_id = $1
    ORDER BY item.position
  `, [attemptId])

  return {
    attemptId: header.attempt_id,
    status: header.status,
    submittedAt: toIso(header.submitted_at),
    rawScore: parseNumeric(header.raw_score),
    maxScore: parseNumeric(header.max_score),
    score: parseNumeric(header.score),
    passed: header.passed,
    passScore: parseNumeric(header.pass_score),
    items: itemResult.rows.map((item) => ({
      itemId: item.item_id,
      outcome: item.outcome,
      earnedScore: parseNumeric(item.earned_score),
      maxScore: parseNumeric(item.max_score),
      prompt: item.prompt,
      selectedText: item.selected_text,
      correctText: item.correct_text,
    })),
  }
}

const readStudentKnowledgeProjections = async (database: Queryable, studentId: string): Promise<StudentKnowledgeProjectionDto[]> => {
  const result = await database.query<StudentKnowledgeProjectionRow>(`
    SELECT sk.student_id, sk.knowledge_point_ref, sk.raw_correct_total::text, sk.raw_attempt_total::text,
           sk.mastery_score::text,
           knowledge_effective_state(sk.state, sk.last_occurred_at, u.exam_date) AS state,
           sk.leech, sk.last_occurred_at,
           knowledge_effective_due_at(sk.due_at, sk.state, sk.last_occurred_at, u.exam_date) AS due_at,
           sk.updated_at
    FROM student_knowledge sk
    JOIN users u ON u.id = sk.student_id
    WHERE sk.student_id = $1
    ORDER BY due_at ASC, sk.knowledge_point_ref ASC
  `, [studentId])
  return result.rows.map((row) => ({
    studentId: row.student_id,
    knowledgePointRef: row.knowledge_point_ref,
    rawCorrectTotal: parseNumeric(row.raw_correct_total),
    rawAttemptTotal: parseNumeric(row.raw_attempt_total),
    masteryScore: parseNumeric(row.mastery_score),
    state: row.state,
    lastOccurredAt: toIso(row.last_occurred_at),
    dueAt: toIso(row.due_at),
    leech: row.leech,
    updatedAt: toIso(row.updated_at),
  }))
}

const readStudentGameState = async (database: Queryable, studentId: string): Promise<StudentGameStateResponse> => {
  const stateResult = await database.query<StudentGameStateRow>(`
    INSERT INTO student_game_state (student_id)
    VALUES ($1)
    ON CONFLICT (student_id) DO UPDATE
      SET updated_at = student_game_state.updated_at
    RETURNING student_id, total_xp, activity_coins, quest_chapter, quest_step, updated_at
  `, [studentId])
  const state = stateResult.rows[0]
  if (!state) throw new Error('student game state could not be read')
  const badgeResult = await database.query<{ badge_code: string }>(`
    SELECT DISTINCT badge_code
    FROM game_reward_ledger
    CROSS JOIN unnest(badge_codes) AS badge_code
    WHERE student_id = $1
    ORDER BY badge_code ASC
  `, [studentId])
  return {
    studentId: state.student_id,
    totalXp: state.total_xp,
    activityCoins: state.activity_coins,
    questChapter: state.quest_chapter,
    questStep: state.quest_step,
    badges: badgeResult.rows.map((row) => row.badge_code),
    updatedAt: toIso(state.updated_at),
  }
}

const applyGameReward = async (database: Queryable, studentId: string, reward: GameRewardGrantDto): Promise<GameRewardGrantDto> => {
  const inserted = await database.query<{ id: string }>(`
    INSERT INTO game_reward_ledger
      (id, student_id, source_type, source_ref, reason, xp_delta, activity_coin_delta, quest_step_delta, quest_chapter_unlocked, badge_codes)
    VALUES
      (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::text[])
    ON CONFLICT (student_id, source_type, source_ref) DO NOTHING
    RETURNING id
  `, [
    studentId,
    reward.source,
    reward.sourceRef,
    reward.reason,
    reward.xpAwarded,
    reward.activityCoinsAwarded,
    reward.questStepDelta,
    reward.questChapterUnlocked,
    reward.badgesAwarded,
  ])
  if (inserted.rowCount === 0) {
    return { ...reward, xpAwarded: 0, activityCoinsAwarded: 0, questStepDelta: 0, questChapterUnlocked: null, badgesAwarded: [] }
  }
  await database.query(`
    INSERT INTO student_game_state
      (student_id, total_xp, activity_coins, quest_chapter, quest_step, updated_at)
    VALUES
      ($1, $2, $3, COALESCE($4, 0), $5, CURRENT_TIMESTAMP)
    ON CONFLICT (student_id) DO UPDATE
    SET total_xp = student_game_state.total_xp + EXCLUDED.total_xp,
        activity_coins = student_game_state.activity_coins + EXCLUDED.activity_coins,
        quest_chapter = GREATEST(student_game_state.quest_chapter, EXCLUDED.quest_chapter),
        quest_step = student_game_state.quest_step + EXCLUDED.quest_step,
        updated_at = CURRENT_TIMESTAMP
  `, [studentId, reward.xpAwarded, reward.activityCoinsAwarded, reward.questChapterUnlocked, reward.questStepDelta])
  return reward
}

// 毎日の関卡を終えたときの報酬。1 回きりのレベルチェック(100/50)より小さくし、
// 毎日積み上がることに意味を持たせます。
const dailySessionReward = (sessionId: string): GameRewardGrantDto => ({
  source: 'daily_session',
  sourceRef: sessionId,
  reason: 'daily_session_completed',
  xpAwarded: 30,
  activityCoinsAwarded: 10,
  questStepDelta: 0,
  questChapterUnlocked: null,
  badgesAwarded: ['daily_session_cleared'],
})

const stageAttemptRewardFor = (result: StageAttemptResultResponse): GameRewardGrantDto => ({
  source: 'stage_attempt',
  sourceRef: result.attemptId,
  reason: result.passed ? 'stage_attempt_passed' : 'stage_attempt_completed',
  xpAwarded: result.passed ? 100 : 40,
  activityCoinsAwarded: result.passed ? 50 : 20,
  questStepDelta: result.passed ? 1 : 0,
  questChapterUnlocked: result.passed ? 1 : null,
  badgesAwarded: result.passed ? ['level_check_cleared'] : ['level_check_challenger'],
})


// ---- 毎日ループ ----

interface DailyItemRow extends Record<string, unknown> {
  id: string
  item_kind: DailyItemKind
  knowledge_point_ref: string
  payload: Record<string, unknown>
}

// 出題時に正解や解説を送らないよう、題型ごとに提示部分だけを取り出します。
// 既定の分岐は置きません。知らない題型は「最後の分岐の形」で配られるより、
// ここで止まるほうが安全です（正解が混ざった payload をそのまま送る事故を防ぎます）。
const publicDailyPrompt = (kind: DailyItemKind, payload: Record<string, unknown>): Record<string, unknown> => {
  switch (kind) {
    case 'word_order':
      return { japanese: payload.japanese, blocks: payload.blocks }
    case 'article':
      return { sentence: payload.sentence, choices: payload.choices, timeLimitSeconds: payload.timeLimitSeconds }
    case 'katakana':
      return { katakana: payload.katakana, choices: payload.choices }
    case 'mcq':
      return { sentence: payload.sentence, choices: payload.choices }
  }
}

// 採点も同じ理由で網羅します。合っている分岐に偶然落ちるのと、
// 意図してその分岐にいるのは別のことです。
// DB の CHECK は pronunciation も許しますが、出題も採点もできません。
// 出題キューはここにある題型だけを拾います。
const renderableItemKinds = [...dailyItemKinds]

const gradeDailyItem = (kind: DailyItemKind, payload: Record<string, unknown>, response: string | string[] | null): boolean => {
  if (response === null) return false
  if (kind === 'word_order') {
    if (!Array.isArray(response)) return false
    const accepted = (payload.answers as string[][] | undefined) ?? []
    return accepted.some((answer) => answer.length === response.length && answer.every((word, index) => word === response[index]))
  }
  if (Array.isArray(response)) return false
  switch (kind) {
    case 'article':
    case 'katakana':
    case 'mcq':
      return response === payload.answer
  }
}

// 体力が尽きたときに出すヒント。正解そのものは返さず、選択肢を 1 つ減らすか
// 最初の語だけを示します。学習を止めない代わりに支えを増やすための仕組みです。
const dailyHintFor = (kind: DailyItemKind, payload: Record<string, unknown>): string => {
  if (kind === 'word_order') {
    const first = (payload.answers as string[][] | undefined)?.[0]?.[0]
    return first ? `最初の語は「${first}」です。` : '主語から並べてみましょう。'
  }
  const choices = (payload.choices as string[] | undefined) ?? []
  const answer = payload.answer as string | undefined
  const wrong = choices.find((choice) => choice !== answer)
  return wrong ? `「${wrong}」は当てはまりません。` : '習った形を思い出してみましょう。'
}

const toDailySession = (row: Record<string, unknown>): DailySessionDto => ({
  sessionId: String(row.id),
  sessionDate: row.session_date instanceof Date ? row.session_date.toISOString().slice(0, 10) : String(row.session_date).slice(0, 10),
  status: row.status as DailySessionDto['status'],
  targetCount: Number(row.target_count),
  completedCount: Number(row.completed_count),
  reviewCount: Number(row.review_count),
})

export class PostgresStudentRepository implements StudentRepository {
  constructor(private readonly pool: Pool) {}

  async create(student: StudentRecord): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, $2, $3, $4)', [student.id, 'student', `${student.birthMonth}-01`, student.isMinor])
      if (student.guardianLinkStatus === 'pending') await client.query('INSERT INTO guardian_links (id, student_id, status) VALUES (gen_random_uuid(), $1, $2)', [student.id, 'pending'])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async createWithAuthIdentity(student: StudentRecord, provider: AuthProvider, providerSubject: string): Promise<CreateStudentWithAuthIdentityResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, $2, $3, $4)', [student.id, 'student', `${student.birthMonth}-01`, student.isMinor])
      await client.query(`
        INSERT INTO auth_identities (id, user_id, provider, provider_subject)
        VALUES (gen_random_uuid(), $1, $2, $3)
      `, [student.id, provider, providerSubject])
      if (student.guardianLinkStatus === 'pending') await client.query('INSERT INTO guardian_links (id, student_id, status) VALUES (gen_random_uuid(), $1, $2)', [student.id, 'pending'])
      await client.query('COMMIT')
      return { status: 'created' }
    } catch (error) {
      await client.query('ROLLBACK')
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return { status: 'identity_conflict' }
      throw error
    } finally {
      client.release()
    }
  }

  async createDemoGuardian(guardianId: string): Promise<void> {
    await this.pool.query(`
      INSERT INTO users (id, role, is_minor)
      VALUES ($1, 'guardian', false)
      ON CONFLICT (id) DO NOTHING
    `, [guardianId])
  }

  async createDemoAuthIdentity(userId: string, provider: AuthProvider, providerSubject: string): Promise<void> {
    await this.pool.query(`
      INSERT INTO auth_identities (id, user_id, provider, provider_subject)
      VALUES (gen_random_uuid(), $1, $2, $3)
      ON CONFLICT (provider, provider_subject) DO NOTHING
    `, [userId, provider, providerSubject])
  }

  async findById(id: string): Promise<StudentRecord | null> {
    const result = await this.pool.query<{ id: string; birth_month: Date | string; is_minor: boolean; status: GuardianLinkStatus | null; guardian_id: string | null }>(`
      SELECT u.id, u.birth_month, u.is_minor, gl.status, gl.guardian_id
      FROM users u
      LEFT JOIN guardian_links gl ON gl.student_id = u.id AND gl.status IN ('pending', 'verified')
      WHERE u.id = $1 AND u.role = 'student' AND u.deleted_at IS NULL
      LIMIT 1
    `, [id])
    const row = result.rows[0]
    if (!row) return null
    const birthMonth = typeof row.birth_month === 'string' ? row.birth_month.slice(0, 7) : row.birth_month.toISOString().slice(0, 7)
    return { id: row.id, birthMonth, isMinor: row.is_minor, guardianLinkStatus: row.status ?? 'not_required', guardianId: row.guardian_id }
  }

  async createGuardianInvite(input: CreateGuardianInviteInput): Promise<GuardianInvitationResponse | null> {
    const result = await this.pool.query<{ invitation_expires_at: Date }>(`
      UPDATE guardian_links
      SET invitation_code_hash = $2,
          invitation_expires_at = $3,
          invitation_created_at = $4
      WHERE student_id = $1
        AND status = 'pending'
      RETURNING invitation_expires_at
    `, [input.studentId, input.inviteCodeHash, input.expiresAt, input.createdAt])
    const row = result.rows[0]
    return row ? { inviteCode: input.inviteCode, expiresAt: toIso(row.invitation_expires_at) } : null
  }

  async verifyGuardianInvite(input: VerifyGuardianInviteInput): Promise<GuardianLinkVerificationResponse | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<{ student_id: string; verified_at: Date }>(`
        UPDATE guardian_links
        SET guardian_id = $1,
            status = 'verified',
            purchase_allowed = true,
            verified_at = $3
        WHERE invitation_code_hash = $2
          AND invitation_expires_at > $3
          AND status = 'pending'
        RETURNING student_id, verified_at
      `, [input.guardianId, input.inviteCodeHash, input.verifiedAt])
      const row = result.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        return null
      }
      await applyGameReward(client, row.student_id, {
        source: 'guardian_verification',
        sourceRef: input.guardianId,
        reason: 'guardian_link_verified',
        xpAwarded: 20,
        activityCoinsAwarded: 0,
        questStepDelta: 0,
        questChapterUnlocked: null,
        badgesAwarded: ['guardian_shield'],
      })
      await client.query('COMMIT')
      return { studentId: row.student_id, status: 'verified', purchaseAllowed: true, verifiedAt: toIso(row.verified_at) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getVoiceConsent(studentId: string, requiredVersion: string): Promise<ConsentRecord> {
    const result = await this.pool.query<{ status: Exclude<ConsentStatus, 'missing' | 'outdated'>; version: string }>('SELECT status, version FROM consent_records WHERE student_id = $1 AND consent_type = $2 ORDER BY created_at DESC LIMIT 1', [studentId, 'voice_processing'])
    const consent = result.rows[0]
    if (!consent) return { status: 'missing', version: null }
    if (consent.status === 'granted' && consent.version !== requiredVersion) return { ...consent, status: 'outdated' }
    return consent
  }

  async setVoiceConsent(studentId: string, guardianId: string | null, status: Exclude<ConsentStatus, 'missing' | 'outdated'>, version: string): Promise<ConsentRecord> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const consent = await client.query<{ id: string }>(`INSERT INTO consent_records (id, student_id, guardian_id, consent_type, status, version, granted_at, withdrawn_at)
        VALUES (gen_random_uuid(), $1, $2, 'voice_processing', $3, $4, CASE WHEN $3::consent_status = 'granted' THEN now() END, CASE WHEN $3::consent_status = 'withdrawn' THEN now() END)
        RETURNING id`, [studentId, guardianId, status, version])
      const consentId = consent.rows[0]?.id
      if (!consentId) throw new Error('voice consent insert did not return an id')
      await client.query(`
        INSERT INTO voice_consent_audit_events
          (id, consent_record_id, student_id, guardian_id, status, version, event_type)
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, $5, 'voice_consent_recorded')
      `, [consentId, studentId, guardianId, status, version])
      if (status === 'withdrawn') {
        await client.query(`
          INSERT INTO voice_data_deletion_jobs
            (id, student_id, guardian_id, source_consent_record_id, reason, status)
          VALUES
            (gen_random_uuid(), $1, $2, $3, 'voice_consent_withdrawn', 'pending')
          ON CONFLICT (source_consent_record_id) DO NOTHING
        `, [studentId, guardianId, consentId])
      }
      await client.query('COMMIT')
      return { status, version }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async listActiveEntitlements(studentId: string, asOf: Date): Promise<string[]> {
    const result = await this.pool.query<{ entitlement_code: string }>(`
      SELECT DISTINCT entitlement_code
      FROM subscription_entitlements
      WHERE student_id = $1
        AND status IN ('active', 'grace_period')
        AND (valid_until IS NULL OR valid_until > $2)
      ORDER BY entitlement_code ASC
    `, [studentId, asOf])
    return result.rows.map((row) => row.entitlement_code)
  }

  async processPaymentWebhook(input: ProcessPaymentWebhookInput): Promise<PaymentWebhookProcessResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const event = await client.query(`
        INSERT INTO payment_webhook_events
          (id, provider, external_event_id, event_type, payment_channel, payload_hash, processing_status, received_at)
        VALUES
          (gen_random_uuid(), $1, $2, $3, 'web_checkout', $4, 'processing', $5)
        ON CONFLICT (provider, external_event_id) DO NOTHING
        RETURNING id
      `, [input.provider, input.externalEventId, input.eventType, input.payloadHash, input.receivedAt])
      if (event.rowCount === 0) {
        const existing = await client.query<{ payload_hash: string }>(`
          SELECT payload_hash
          FROM payment_webhook_events
          WHERE provider = $1 AND external_event_id = $2
          LIMIT 1
        `, [input.provider, input.externalEventId])
        if (existing.rows[0]?.payload_hash !== input.payloadHash) {
          await client.query('COMMIT')
          return { status: 'payload_mismatch' }
        }
        await client.query('COMMIT')
        return { status: 'duplicate' }
      }

      const guardianLink = await client.query<{ id: string }>(`
        SELECT id
        FROM guardian_links
        WHERE student_id = $1
          AND guardian_id = $2
          AND status = 'verified'
        LIMIT 1
      `, [input.studentId, input.purchaserGuardianId])
      if (guardianLink.rowCount === 0) {
        await client.query(`
          UPDATE payment_webhook_events
          SET processing_status = 'failed',
              error_code = 'GUARDIAN_VERIFICATION_REQUIRED',
              processed_at = CURRENT_TIMESTAMP
          WHERE provider = $1 AND external_event_id = $2
        `, [input.provider, input.externalEventId])
        await client.query('COMMIT')
        return { status: 'invalid_guardian_link' }
      }

      await client.query(`
        INSERT INTO subscription_entitlements
          (id, student_id, purchaser_guardian_id, payment_channel, external_subscription_id, entitlement_code, status, valid_until)
        VALUES
          (gen_random_uuid(), $1, $2, 'web_checkout', $3, $4, $5, $6)
        ON CONFLICT (payment_channel, external_subscription_id, entitlement_code) DO UPDATE
        SET student_id = EXCLUDED.student_id,
            purchaser_guardian_id = EXCLUDED.purchaser_guardian_id,
            status = EXCLUDED.status,
            valid_until = EXCLUDED.valid_until,
            updated_at = CURRENT_TIMESTAMP
      `, [input.studentId, input.purchaserGuardianId, input.externalSubscriptionId, input.entitlementCode, input.status, input.validUntil])
      await client.query(`
        UPDATE payment_webhook_events
        SET processing_status = 'processed',
            processed_at = CURRENT_TIMESTAMP
        WHERE provider = $1 AND external_event_id = $2
      `, [input.provider, input.externalEventId])
      await client.query('COMMIT')
      return { status: 'processed' }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async upsertCurrentDevice(input: UpsertCurrentDeviceInput): Promise<CurrentDeviceRegistrationResponse> {
    const result = await this.pool.query<{ platform: ClientPlatform; push_enabled: boolean; last_seen_at: Date }>(`
      INSERT INTO user_devices
        (id, user_id, platform, device_id_hash, app_version, os_version, push_enabled, last_seen_at)
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4, $5, false, $6)
      ON CONFLICT (user_id, device_id_hash) DO UPDATE
      SET platform = EXCLUDED.platform,
          app_version = EXCLUDED.app_version,
          os_version = EXCLUDED.os_version,
          last_seen_at = EXCLUDED.last_seen_at
      RETURNING platform, push_enabled, last_seen_at
    `, [input.studentId, input.platform, input.deviceIdHash, input.appVersion ?? null, input.osVersion ?? null, input.lastSeenAt])
    const row = result.rows[0]
    if (!row) throw new Error('device upsert did not return a row')
    return { platform: row.platform, pushEnabled: row.push_enabled, lastSeenAt: toIso(row.last_seen_at) }
  }

  async disableCurrentDevicePush(input: UpsertCurrentDeviceInput): Promise<CurrentDeviceRegistrationResponse | null> {
    const result = await this.pool.query<{ platform: ClientPlatform; push_enabled: boolean; last_seen_at: Date }>(`
      UPDATE user_devices
      SET platform = $2,
          app_version = $4,
          os_version = $5,
          push_token_encrypted = NULL,
          push_enabled = false,
          last_seen_at = $6
      WHERE user_id = $1
        AND device_id_hash = $3
      RETURNING platform, push_enabled, last_seen_at
    `, [input.studentId, input.platform, input.deviceIdHash, input.appVersion ?? null, input.osVersion ?? null, input.lastSeenAt])
    const row = result.rows[0]
    return row ? { platform: row.platform, pushEnabled: row.push_enabled, lastSeenAt: toIso(row.last_seen_at) } : null
  }

  async startTrial(studentId: string, attemptId: string, expiresAt: Date): Promise<TrialStartResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const redemption = await client.query('INSERT INTO trial_redemptions (student_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING student_id', [studentId])
      if (redemption.rowCount === 0) {
        await client.query('ROLLBACK')
        return { status: 'redeemed' }
      }
      await client.query('INSERT INTO trial_attempts (id, student_id, expires_at) VALUES ($1, $2, $3)', [attemptId, studentId, expiresAt])
      await client.query('COMMIT')
      return { status: 'created', attempt: { id: attemptId, studentId, currentIndex: 0, score: 0, expiresAt } }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async findTrialAttempt(attemptId: string): Promise<TrialAttemptRecord | null> {
    const result = await this.pool.query<{ id: string; student_id: string; current_index: number; transient_score: number; expires_at: Date }>('SELECT id, student_id, current_index, transient_score, expires_at FROM trial_attempts WHERE id = $1', [attemptId])
    const row = result.rows[0]
    return row ? { id: row.id, studentId: row.student_id, currentIndex: row.current_index, score: row.transient_score, expiresAt: row.expires_at } : null
  }

  async advanceTrialAttempt(attemptId: string, expectedIndex: number, correct: boolean): Promise<TrialAttemptRecord | null> {
    const result = await this.pool.query<{ id: string; student_id: string; current_index: number; transient_score: number; expires_at: Date }>(`UPDATE trial_attempts SET current_index = current_index + 1, transient_score = transient_score + $3
      WHERE id = $1 AND current_index = $2 RETURNING id, student_id, current_index, transient_score, expires_at`, [attemptId, expectedIndex, correct ? 1 : 0])
    const row = result.rows[0]
    return row ? { id: row.id, studentId: row.student_id, currentIndex: row.current_index, score: row.transient_score, expiresAt: row.expires_at } : null
  }

  async completeTrialAttempt(attemptId: string): Promise<void> {
    await this.pool.query('DELETE FROM trial_attempts WHERE id = $1', [attemptId])
  }

  async startStageAttempt(input: StartStageAttemptInput): Promise<StageAttemptStartResult> {
    const client = await this.pool.connect()
    const operationScope = `stage_attempt.start:v1:${input.stageExamId}`
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [input.studentId, input.stageExamId])

      const idempotency = await client.query<{
        status: 'in_progress' | 'completed'
        request_hash: Buffer
        http_status: number | null
        response_body: StartStageAttemptResponse | null
      } & Record<string, unknown>>(`
        INSERT INTO idempotency_records
          (student_id, operation_scope, idempotency_key, request_hash, expires_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + interval '24 hours')
        ON CONFLICT (student_id, operation_scope, idempotency_key) DO NOTHING
        RETURNING status, request_hash, http_status, response_body
      `, [input.studentId, operationScope, input.idempotencyKey, input.requestHash])

      if (idempotency.rowCount === 0) {
        const existing = await client.query<{
          status: 'in_progress' | 'completed'
          request_hash: Buffer
          http_status: number | null
          response_body: StartStageAttemptResponse | null
        } & Record<string, unknown>>(`
          SELECT status, request_hash, http_status, response_body
          FROM idempotency_records
          WHERE student_id = $1 AND operation_scope = $2 AND idempotency_key = $3
          FOR UPDATE
        `, [input.studentId, operationScope, input.idempotencyKey])
        const row = existing.rows[0]
        if (!row || !Buffer.from(row.request_hash).equals(input.requestHash)) {
          await client.query('ROLLBACK')
          return { status: 'key_reused' }
        }
        if (row.status === 'in_progress') {
          await client.query('ROLLBACK')
          return { status: 'request_in_progress' }
        }
        if (!row.response_body || row.http_status === null) throw new Error('Completed idempotency record is missing its response snapshot')
        await client.query('COMMIT')
        return { status: 'replayed', httpStatus: row.http_status, attempt: row.response_body }
      }

      const existingOpen = await client.query<{ id: string } & Record<string, unknown>>(`
        SELECT a.id
        FROM stage_attempts a
        JOIN stage_exam_versions ev ON ev.id = a.exam_version_id
        WHERE a.student_id = $1 AND ev.exam_id = $2 AND a.status = 'open'
        LIMIT 1
        FOR UPDATE OF a
      `, [input.studentId, input.stageExamId])
      if (existingOpen.rows[0]) {
        await client.query('ROLLBACK')
        return { status: 'already_open' }
      }

      // 再受験のゲート。同じスナップショットを続けて解いても、点は上がるのに力は増えません。
      const gate = await client.query<{ allowed: boolean; days_remaining: number; sessions_remaining: number }>(
        'SELECT allowed, days_remaining, sessions_remaining FROM stage_retake_gate($1, $2)',
        [input.studentId, input.stageExamId],
      )
      if (!gate.rows[0]!.allowed) {
        await client.query('ROLLBACK')
        return {
          status: 'cooldown',
          daysRemaining: Number(gate.rows[0]!.days_remaining),
          sessionsRemaining: Number(gate.rows[0]!.sessions_remaining),
        }
      }

      const version = await client.query<{ id: string; duration_seconds: number } & Record<string, unknown>>(`
        SELECT ev.id, ev.duration_seconds
        FROM stage_exam_versions ev
        LEFT JOIN stage_exam_version_retirements r ON r.exam_version_id = ev.id
        WHERE ev.exam_id = $1
          AND ev.status = 'published'
          AND (r.retired_at IS NULL OR r.retired_at > CURRENT_TIMESTAMP)
        ORDER BY ev.version DESC
        LIMIT 1
        FOR UPDATE OF ev
      `, [input.stageExamId])
      const examVersion = version.rows[0]
      if (!examVersion) {
        await client.query('ROLLBACK')
        return { status: 'exam_not_available' }
      }

      await client.query(`
        INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP + make_interval(secs => $4))
      `, [input.attemptId, input.studentId, examVersion.id, examVersion.duration_seconds])
      await client.query(`
        INSERT INTO stage_attempt_start_idempotency
          (student_id, exam_id, operation_scope, idempotency_key, attempt_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [input.studentId, input.stageExamId, operationScope, input.idempotencyKey, input.attemptId])
      await client.query(`
        INSERT INTO learning_audit_events
          (event_id, event_type, actor_id, actor_role, actor_auth_provider,
           actor_provider_subject, actor_relationship, student_id, attempt_id,
           request_id, reason, occurred_at)
        SELECT $1, 'attempt_started', $2, 'student', $3, $4, 'self',
               $2, a.id, $5, 'stage_attempt_started', a.started_at
        FROM stage_attempts a
        WHERE a.id = $6 AND a.student_id = $2
      `, [input.eventId, input.studentId, input.actorAuthProvider, input.actorProviderSubject, input.requestId, input.attemptId])

      const attempt = await readStageAttemptView(client, input.studentId, input.attemptId)
      if (!attempt) throw new Error('Created stage attempt could not be read')
      await client.query(`
        UPDATE idempotency_records
        SET status = 'completed',
            http_status = 201,
            response_headers = '{}'::jsonb,
            response_body = $4::jsonb,
            completed_at = CURRENT_TIMESTAMP
        WHERE student_id = $1 AND operation_scope = $2 AND idempotency_key = $3
      `, [input.studentId, operationScope, input.idempotencyKey, JSON.stringify(attempt)])
      await client.query('COMMIT')
      return { status: 'created', httpStatus: 201, attempt }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async findStageAttempt(studentId: string, attemptId: string): Promise<StartStageAttemptResponse | null> {
    return readStageAttemptView(this.pool, studentId, attemptId)
  }

  async submitStageAttempt(input: SubmitStageAttemptInput): Promise<StageAttemptSubmitResult> {
    const client = await this.pool.connect()
    const operationScope = `stage_attempt.submit:v1:${input.attemptId}`
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [input.studentId, input.attemptId])

      const idempotency = await client.query<{
        status: 'in_progress' | 'completed'
        request_hash: Buffer
        http_status: number | null
        response_body: StageAttemptResultResponse | Record<string, unknown> | null
      } & Record<string, unknown>>(`
        INSERT INTO idempotency_records
          (student_id, operation_scope, idempotency_key, request_hash, expires_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + interval '24 hours')
        ON CONFLICT (student_id, operation_scope, idempotency_key) DO NOTHING
        RETURNING status, request_hash, http_status, response_body
      `, [input.studentId, operationScope, input.idempotencyKey, input.requestHash])

      if (idempotency.rowCount === 0) {
        const existing = await client.query<{
          status: 'in_progress' | 'completed'
          request_hash: Buffer
          http_status: number | null
          response_body: StageAttemptResultResponse | Record<string, unknown> | null
        } & Record<string, unknown>>(`
          SELECT status, request_hash, http_status, response_body
          FROM idempotency_records
          WHERE student_id = $1 AND operation_scope = $2 AND idempotency_key = $3
          FOR UPDATE
        `, [input.studentId, operationScope, input.idempotencyKey])
        const row = existing.rows[0]
        if (!row || !Buffer.from(row.request_hash).equals(input.requestHash)) {
          await client.query('ROLLBACK')
          return { status: 'key_reused' }
        }
        if (row.status === 'in_progress') {
          await client.query('ROLLBACK')
          return { status: 'request_in_progress' }
        }
        if (!row.response_body || row.http_status === null) throw new Error('Completed submit idempotency record is missing its response snapshot')
        if (row.http_status === 410) {
          await client.query('COMMIT')
          return { status: 'expired' }
        }
        await client.query('COMMIT')
        return { status: 'replayed', httpStatus: row.http_status, result: row.response_body as StageAttemptResultResponse }
      }

      const attempt = await client.query<{
        id: string
        status: 'open' | 'passed' | 'failed' | 'expired'
        expires_at: Date
        is_expired: boolean
      } & Record<string, unknown>>(`
        SELECT id, status, expires_at, expires_at <= CURRENT_TIMESTAMP AS is_expired
        FROM stage_attempts
        WHERE id = $1 AND student_id = $2
        FOR UPDATE
      `, [input.attemptId, input.studentId])
      const attemptRow = attempt.rows[0]
      if (!attemptRow) {
        await client.query('ROLLBACK')
        return { status: 'attempt_not_found' }
      }
      if (attemptRow.status === 'expired') {
        await client.query('ROLLBACK')
        return { status: 'expired' }
      }
      if (attemptRow.status !== 'open') {
        await client.query('ROLLBACK')
        return { status: 'already_finalized' }
      }
      if (attemptRow.is_expired) {
        await client.query(`
          UPDATE stage_attempts
          SET status = 'expired',
              expired_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [input.attemptId])
        await client.query(`
          INSERT INTO learning_audit_events
            (event_id, event_type, actor_id, actor_role, actor_auth_provider,
             actor_provider_subject, actor_relationship, student_id, attempt_id,
             request_id, reason, occurred_at)
          SELECT $1, 'attempt_expired', $2, 'student', $3, $4, 'self',
                 $2, a.id, $5, 'stage_attempt_expired', a.expired_at
          FROM stage_attempts a
          WHERE a.id = $6 AND a.student_id = $2
        `, [input.eventId, input.studentId, input.actorAuthProvider, input.actorProviderSubject, input.requestId, input.attemptId])
        await client.query(`
          UPDATE idempotency_records
          SET status = 'completed',
              http_status = 410,
              response_headers = '{}'::jsonb,
              response_body = '{"code":"STAGE_ATTEMPT_EXPIRED"}'::jsonb,
              completed_at = CURRENT_TIMESTAMP
          WHERE student_id = $1 AND operation_scope = $2 AND idempotency_key = $3
        `, [input.studentId, operationScope, input.idempotencyKey])
        await client.query('COMMIT')
        return { status: 'expired' }
      }

      const itemResult = await client.query<{ item_id: string } & Record<string, unknown>>(`
        SELECT id AS item_id
        FROM stage_attempt_item_snapshots
        WHERE attempt_id = $1
        ORDER BY position
      `, [input.attemptId])
      const expectedItemIds = new Set(itemResult.rows.map(({ item_id }) => item_id))
      const seenItemIds = new Set<string>()
      if (input.answers.length !== expectedItemIds.size) {
        await client.query('ROLLBACK')
        return { status: 'invalid_submission' }
      }
      for (const answer of input.answers) {
        if (!expectedItemIds.has(answer.itemId) || seenItemIds.has(answer.itemId)) {
          await client.query('ROLLBACK')
          return { status: 'invalid_submission' }
        }
        seenItemIds.add(answer.itemId)
        if (answer.selectedOptionId !== null) {
          const option = await client.query<{ id: string } & Record<string, unknown>>(`
            SELECT id
            FROM stage_attempt_item_option_snapshots
            WHERE item_snapshot_id = $1 AND id = $2
          `, [answer.itemId, answer.selectedOptionId])
          if (!option.rows[0]) {
            await client.query('ROLLBACK')
            return { status: 'invalid_submission' }
          }
        }
      }

      for (const [index, answer] of input.answers.entries()) {
        await client.query(`
          INSERT INTO stage_attempt_answers
            (attempt_id, item_snapshot_id, answer_status, selected_option_snapshot_id, idempotency_key)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          input.attemptId,
          answer.itemId,
          answer.selectedOptionId === null ? 'skipped' : 'answered',
          answer.selectedOptionId,
          `submit-${index + 1}`,
        ])
      }

      await client.query(`
        WITH totals AS (
          SELECT sum(earned_score)::numeric(12,6) AS earned_score,
                 sum(max_score)::numeric(12,6) AS max_score
          FROM stage_attempt_answers
          WHERE attempt_id = $1
        ),
        graded AS (
          SELECT round(totals.earned_score / totals.max_score, 6)::numeric(12,6) AS score,
                 ev.pass_score
          FROM stage_attempts a
          JOIN stage_exam_versions ev ON ev.id = a.exam_version_id
          CROSS JOIN totals
          WHERE a.id = $1
        )
        UPDATE stage_attempts
        SET status = CASE WHEN graded.score >= graded.pass_score THEN 'passed'::stage_attempt_status ELSE 'failed'::stage_attempt_status END,
            submitted_at = CURRENT_TIMESTAMP,
            score = graded.score,
            passed = graded.score >= graded.pass_score,
            updated_at = CURRENT_TIMESTAMP
        FROM graded
        WHERE stage_attempts.id = $1
      `, [input.attemptId])

      await client.query('SELECT create_stage_attempt_knowledge_evidence($1, $2)', [input.attemptId, input.studentId])
      await client.query('SELECT apply_stage_attempt_mastery_due($1, $2)', [input.attemptId, input.studentId])

      await client.query(`
        INSERT INTO learning_audit_events
          (event_id, event_type, actor_id, actor_role, actor_auth_provider,
           actor_provider_subject, actor_relationship, student_id, attempt_id,
           request_id, reason, occurred_at)
        SELECT $1, 'attempt_submitted', $2, 'student', $3, $4, 'self',
               $2, a.id, $5, 'stage_attempt_submitted', a.submitted_at
        FROM stage_attempts a
        WHERE a.id = $6 AND a.student_id = $2
      `, [input.eventId, input.studentId, input.actorAuthProvider, input.actorProviderSubject, input.requestId, input.attemptId])

      const result = await readStageAttemptResult(client, input.studentId, input.attemptId)
      if (!result) throw new Error('Submitted stage attempt result could not be read')
      // 同じ試験を受け直しても報酬は出ません。出題が毎回同じスナップショットなので、
      // 覚えて回せば無限に XP を稼げてしまうためです。台帳には 0 で残し、履歴は追えるようにします。
      const alreadyRewarded = await client.query(`
        WITH this_exam AS (
          SELECT ev.exam_id
          FROM stage_attempts a
          JOIN stage_exam_versions ev ON ev.id = a.exam_version_id
          WHERE a.id = $2
        )
        SELECT 1
        FROM game_reward_ledger ledger
        JOIN stage_attempts a ON a.id = ledger.source_ref::uuid
        JOIN stage_exam_versions ev ON ev.id = a.exam_version_id
        JOIN this_exam ON this_exam.exam_id = ev.exam_id
        WHERE ledger.student_id = $1
          AND ledger.source_type = 'stage_attempt'
          AND ledger.xp_delta > 0
          AND a.id <> $2
        LIMIT 1
      `, [input.studentId, input.attemptId])
      const reward = stageAttemptRewardFor(result)
      result.rewards = await applyGameReward(
        client,
        input.studentId,
        alreadyRewarded.rows[0]
          ? { ...reward, xpAwarded: 0, activityCoinsAwarded: 0, questStepDelta: 0, questChapterUnlocked: null, badgesAwarded: [] }
          : reward,
      )
      await client.query(`
        UPDATE idempotency_records
        SET status = 'completed',
            http_status = 200,
            response_headers = '{}'::jsonb,
            response_body = $4::jsonb,
            completed_at = CURRENT_TIMESTAMP
        WHERE student_id = $1 AND operation_scope = $2 AND idempotency_key = $3
      `, [input.studentId, operationScope, input.idempotencyKey, JSON.stringify(result)])
      await client.query('COMMIT')
      return { status: 'submitted', httpStatus: 200, result }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async findStageAttemptResult(studentId: string, attemptId: string): Promise<StageAttemptResultResponse | null> {
    return readStageAttemptResult(this.pool, studentId, attemptId)
  }

  async listStudentKnowledgeProjections(studentId: string): Promise<StudentKnowledgeProjectionDto[]> {
    return readStudentKnowledgeProjections(this.pool, studentId)
  }

  async getStudentGameState(studentId: string): Promise<StudentGameStateResponse> {
    return readStudentGameState(this.pool, studentId)
  }

  // 日付は Asia/Tokyo で切ります。UTC で切ると日本の朝 9 時前が前日扱いになります。
  async getDailyPlan(studentId: string): Promise<DailyPlanResponse> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT settle_life_refill($1)', [studentId])
      const state = await client.query<{ lives: number; refill_anchor_at: Date; session_date: string; review_cap: number }>(`
        SELECT sl.lives, sl.refill_anchor_at,
               (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date::text AS session_date,
               daily_review_cap($1) AS review_cap
        FROM student_lives sl WHERE sl.student_id = $1
      `, [studentId])
      const row = state.rows[0]!
      const session = await client.query(`
        SELECT id, session_date, status, target_count, completed_count, review_count
        FROM daily_sessions WHERE student_id = $1 AND session_date = $2::date
      `, [studentId, row.session_date])
      const streak = await client.query<{ current_days: number; freeze_available: boolean; last_study_date: string | null }>(
        'SELECT current_days, freeze_available, last_study_date::text FROM daily_streak($1)', [studentId],
      )
      await client.query('COMMIT')
      return {
        sessionDate: row.session_date,
        streak: {
          days: Number(streak.rows[0]!.current_days),
          // 今日ぶんが数に入っているかどうかは画面で言い分けます。
          // 「3日連続」と出したあとで今日サボれる状態は、B-1 で消した誤解と同じ種類です。
          countedToday: streak.rows[0]!.last_study_date === row.session_date,
          freezeAvailable: streak.rows[0]!.freeze_available,
          lastStudyDate: streak.rows[0]!.last_study_date,
        },
        lives: Number(row.lives),
        maxLives: 5,
        supportMode: Number(row.lives) <= 0,
        nextLifeAt: Number(row.lives) >= 5 ? null : new Date(row.refill_anchor_at.getTime() + 30 * 60 * 1000).toISOString(),
        reviewCap: Number(row.review_cap),
        session: session.rows[0] ? toDailySession(session.rows[0]) : null,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async startDailySession(studentId: string): Promise<DailySessionStartResponse | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [studentId, 'daily_session'])
      const today = await client.query<{ session_date: string }>(
        "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date::text AS session_date",
      )
      const sessionDate = today.rows[0]!.session_date

      // 復習は上限まで、残りを新規で埋めます（PRD: 復習は普通の関卡に混ぜる）。
      const cap = await client.query<{ daily_review_cap: number }>('SELECT daily_review_cap($1)', [studentId])
      const reviewCap = Number(cap.rows[0]!.daily_review_cap)
      // 1 日 19 問。120 知識ポイント × 12 回 ÷ 77 学習日 から逆算した数です。
      // 題庫が足りないうちは、公開済みの数だけで関卡を作ります（最低 12 問）。
      const target = 19

      const reviews = await client.query<DailyItemRow>(`
        SELECT ci.id, ci.item_kind, ci.knowledge_point_ref, ci.payload
        FROM student_knowledge sk
        JOIN content_items ci ON ci.knowledge_point_ref = sk.knowledge_point_ref
          AND ci.status = 'published' AND ci.item_kind = ANY($4::text[])
        JOIN users u ON u.id = sk.student_id
        WHERE sk.student_id = $1
          AND knowledge_effective_due_at(sk.due_at, sk.state, sk.last_occurred_at, u.exam_date) <= CURRENT_TIMESTAMP
        ORDER BY knowledge_effective_due_at(sk.due_at, sk.state, sk.last_occurred_at, u.exam_date) ASC
        LIMIT least($2::int, $3::int)
      `, [studentId, reviewCap, target, renderableItemKinds])
      const reviewIds = reviews.rows.map((item) => item.id)

      // 新規の知識ポイントは 1 日 3 個まで。さらに、期限切れの滞留が日額の 1.5 倍を超えたら
      // 新規はゼロにします。この閘門がないと 2 週目に終わらない待ち行列が育ちます。
      // 数えるのは実効の期限です。鮮度切れの習得項目も滞留に含めないと過小申告になります。
      const backlog = await client.query<{ overdue: number }>(`
        SELECT count(*)::int AS overdue
        FROM student_knowledge sk
        JOIN users u ON u.id = sk.student_id
        WHERE sk.student_id = $1
          AND knowledge_effective_due_at(sk.due_at, sk.state, sk.last_occurred_at, u.exam_date) <= CURRENT_TIMESTAMP
      `, [studentId])
      const intake = Number(backlog.rows[0]!.overdue) > Math.floor(target * 1.5) ? 0 : 3

      const fresh = await client.query<DailyItemRow>(`
        WITH admitted AS (
          SELECT DISTINCT ci.knowledge_point_ref
          FROM content_items ci
          WHERE ci.status = 'published' AND ci.item_kind = ANY($5::text[])
            AND NOT EXISTS (
              SELECT 1 FROM student_knowledge sk
              WHERE sk.student_id = $3 AND sk.knowledge_point_ref = ci.knowledge_point_ref
            )
          ORDER BY ci.knowledge_point_ref
          LIMIT $4::int
        )
        SELECT id, item_kind, knowledge_point_ref, payload FROM (
          SELECT id, item_kind, knowledge_point_ref, payload,
                 row_number() OVER (PARTITION BY knowledge_point_ref ORDER BY created_at) AS seat
          FROM content_items
          WHERE status = 'published' AND item_kind = ANY($5::text[])
            AND ($2::uuid[] = '{}' OR id <> ALL($2::uuid[]))
            AND knowledge_point_ref IN (SELECT knowledge_point_ref FROM admitted)
        ) ranked
        ORDER BY seat, knowledge_point_ref
        LIMIT $1::int
      `, [target - reviews.rows.length, reviewIds, studentId, intake, renderableItemKinds])

      // 閘門は新しい知識ポイントを増やさないためのものです。すでに回転に入っている
      // ポイントの追加練習は待ち行列を伸ばさないので、最低問数に届かないぶんはこれで埋めます。
      const pickedIds = [...reviewIds, ...fresh.rows.map((item) => item.id)]
      const shortfall = target - reviews.rows.length - fresh.rows.length
      const filler = shortfall > 0
        ? await client.query<DailyItemRow>(`
            SELECT id, item_kind, knowledge_point_ref, payload FROM (
              SELECT id, item_kind, knowledge_point_ref, payload,
                     row_number() OVER (PARTITION BY knowledge_point_ref ORDER BY created_at) AS seat
              FROM content_items
              WHERE status = 'published' AND item_kind = ANY($4::text[])
                AND ($2::uuid[] = '{}' OR id <> ALL($2::uuid[]))
                AND EXISTS (
                  SELECT 1 FROM student_knowledge sk
                  WHERE sk.student_id = $3 AND sk.knowledge_point_ref = content_items.knowledge_point_ref
                )
            ) ranked
            ORDER BY seat, knowledge_point_ref
            LIMIT $1::int
          `, [shortfall, pickedIds, studentId, renderableItemKinds])
        : { rows: [] as DailyItemRow[] }

      // 投入上限はペース配分、12 問は試験カバレッジの下限です。ぶつかったら下限が勝ちます。
      // 題庫が 4 ポイントしかないうちは上限 3 だと 12 問に届かないので、ここで足します。
      // 題庫が育てば（A-1）この経路は自然に使われなくなります。
      const capped = [...reviews.rows, ...fresh.rows, ...filler.rows]
      const topUp = capped.length < 12
        ? await client.query<DailyItemRow>(`
            SELECT id, item_kind, knowledge_point_ref, payload FROM (
              SELECT id, item_kind, knowledge_point_ref, payload,
                     row_number() OVER (PARTITION BY knowledge_point_ref ORDER BY created_at) AS seat
              FROM content_items
              WHERE status = 'published' AND item_kind = ANY($3::text[])
                AND ($2::uuid[] = '{}' OR id <> ALL($2::uuid[]))
            ) ranked
            ORDER BY seat, knowledge_point_ref
            LIMIT $1::int
          `, [target - capped.length, capped.map((item) => item.id), renderableItemKinds])
        : { rows: [] as DailyItemRow[] }

      const picked = [...capped, ...topUp.rows]
      if (picked.length < 12) {
        await client.query('ROLLBACK')
        return null
      }

      const created = await client.query(`
        INSERT INTO daily_sessions (student_id, session_date, target_count, review_count)
        VALUES ($1, $2::date, $3, $4)
        ON CONFLICT (student_id, session_date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
        RETURNING id, session_date, status, target_count, completed_count, review_count
      `, [studentId, sessionDate, picked.length, reviews.rows.length])
      await client.query('COMMIT')

      const reviewSet = new Set(reviewIds)
      return {
        session: toDailySession(created.rows[0]!),
        items: picked.map((item): DailyItemDto => ({
          contentItemId: item.id,
          itemKind: item.item_kind,
          knowledgePointRef: item.knowledge_point_ref,
          isReview: reviewSet.has(item.id),
          prompt: publicDailyPrompt(item.item_kind, item.payload),
        })),
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getDailyHint(studentId: string, sessionId: string, contentItemId: string): Promise<DailyHintResponse | null> {
    const lives = await this.pool.query<{ settle_life_refill: number }>('SELECT settle_life_refill($1) AS settle_life_refill', [studentId])
    // 体力が残っているうちはヒントを出しません。まず自分で考えてもらうためです。
    if (Number(lives.rows[0]!.settle_life_refill) > 0) return null
    const owned = await this.pool.query(
      'SELECT 1 FROM daily_sessions WHERE id = $1 AND student_id = $2', [sessionId, studentId],
    )
    if (!owned.rows[0]) return null
    const item = await this.pool.query<DailyItemRow>(
      "SELECT id, item_kind, knowledge_point_ref, payload FROM content_items WHERE id = $1 AND status = 'published'",
      [contentItemId],
    )
    if (!item.rows[0]) return null
    return { contentItemId, hint: dailyHintFor(item.rows[0].item_kind, item.rows[0].payload) }
  }

  async submitDailyAnswer(input: { studentId: string; sessionId: string; contentItemId: string; response: string | string[] | null; timedOut: boolean }): Promise<DailyAnswerResponse | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const session = await client.query(`
        SELECT id, session_date, status, target_count, completed_count, review_count
        FROM daily_sessions WHERE id = $1 AND student_id = $2 FOR UPDATE
      `, [input.sessionId, input.studentId])
      if (!session.rows[0]) {
        await client.query('ROLLBACK')
        return null
      }
      const item = await client.query<DailyItemRow>(
        "SELECT id, item_kind, knowledge_point_ref, payload FROM content_items WHERE id = $1 AND status = 'published'",
        [input.contentItemId],
      )
      if (!item.rows[0]) {
        await client.query('ROLLBACK')
        return null
      }
      const { item_kind: kind, payload, knowledge_point_ref: knowledgePointRef } = item.rows[0]
      const correct = !input.timedOut && gradeDailyItem(kind, payload, input.response)
      const outcome = input.timedOut ? 'skipped' : correct ? 'correct' : 'incorrect'

      const inserted = await client.query(`
        INSERT INTO daily_answers
          (session_id, student_id, content_item_id, knowledge_point_ref, is_review, outcome, timed_out, earned_score, max_score, occurred_at)
        VALUES ($1, $2, $3, $4, false, $5, $6, $7, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (session_id, content_item_id) DO NOTHING
        RETURNING id
      `, [input.sessionId, input.studentId, input.contentItemId, knowledgePointRef, outcome, input.timedOut, correct ? 1 : 0])

      // タイムアウトは知識の誤りではないので生命値を減らしません（P0-13）。
      let lives: number
      if (inserted.rows[0] && !correct && !input.timedOut) {
        const spent = await client.query<{ spend_life: number }>('SELECT spend_life($1, $2) AS spend_life', [
          input.studentId, `${input.sessionId}:${input.contentItemId}`,
        ])
        lives = Number(spent.rows[0]!.spend_life)
      } else {
        const settled = await client.query<{ settle_life_refill: number }>('SELECT settle_life_refill($1) AS settle_life_refill', [input.studentId])
        lives = Number(settled.rows[0]!.settle_life_refill)
      }

      const updated = await client.query(`
        UPDATE daily_sessions ds
        SET completed_count = sub.answered,
            status = CASE WHEN sub.answered >= ds.target_count THEN 'completed' ELSE ds.status END,
            completed_at = CASE WHEN sub.answered >= ds.target_count THEN CURRENT_TIMESTAMP ELSE ds.completed_at END,
            updated_at = CURRENT_TIMESTAMP
        FROM (SELECT count(*)::int AS answered FROM daily_answers WHERE session_id = $1) AS sub
        WHERE ds.id = $1
        RETURNING ds.id, ds.session_date, ds.status, ds.target_count, ds.completed_count, ds.review_count
      `, [input.sessionId])
      // 解答するたびに習熟度と復習期日を進めます。関数は適用済み台帳で冪等です。
      await client.query('SELECT apply_daily_session_mastery_due($1, $2)', [input.sessionId, input.studentId])

      // 関卡を終えたときだけ報酬を出します。source_ref がセッション ID なので 1 日 1 回です。
      const updatedSession = toDailySession(updated.rows[0]!)
      let rewards: GameRewardGrantDto | undefined
      if (updatedSession.status === 'completed') {
        const granted = await applyGameReward(client, input.studentId, dailySessionReward(input.sessionId))
        if (granted.xpAwarded > 0 || granted.activityCoinsAwarded > 0) rewards = granted
      }
      await client.query('COMMIT')

      return {
        correct,
        timedOut: input.timedOut,
        explanation: String(payload.explanation ?? ''),
        lives,
        supportMode: lives <= 0,
        session: updatedSession,
        ...(rewards ? { rewards } : {}),
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * 学習計画。母数は「台帳にある範囲」ではなく「いま出題できる点」です。
   * 56 点の範囲を約束しても題庫が 5 点しか無ければ、守れない数字を見せることになります。
   * パーセントは出しません（B-1 と同じ理由：動かない数字は進捗に見えて進捗ではありません）。
   */
  async getStudyPlan(studentId: string): Promise<StudyPlanResponse> {
    const rows = await this.pool.query<{
      teachable: number; started: number; steady: number; exam_date: string | null; days_remaining: number | null
    }>(`
      WITH teachable AS (
        SELECT DISTINCT knowledge_point_ref FROM content_items WHERE status = 'published'
      )
      SELECT
        (SELECT count(*)::int FROM teachable) AS teachable,
        (SELECT count(*)::int FROM student_knowledge sk
           JOIN teachable t ON t.knowledge_point_ref = sk.knowledge_point_ref
         WHERE sk.student_id = $1) AS started,
        (SELECT count(*)::int FROM student_knowledge sk
           JOIN teachable t ON t.knowledge_point_ref = sk.knowledge_point_ref
           JOIN users u ON u.id = sk.student_id
         WHERE sk.student_id = $1
           AND knowledge_effective_state(sk.state, sk.last_occurred_at, u.exam_date) IN ('review', 'mastered')) AS steady,
        (SELECT exam_date::text FROM users WHERE id = $1) AS exam_date,
        (SELECT (exam_date - (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date) FROM users WHERE id = $1) AS days_remaining
    `, [studentId])
    const row = rows.rows[0]!

    // 次に学ぶ点は教える順で決めます。CEFR-J のレベル順ではありません（頻度順なので教材には使えません）。
    const pending = await this.pool.query<{ knowledge_point_ref: string }>(`
      SELECT DISTINCT ci.knowledge_point_ref
      FROM content_items ci
      WHERE ci.status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM student_knowledge sk
          WHERE sk.student_id = $1 AND sk.knowledge_point_ref = ci.knowledge_point_ref
        )
    `, [studentId])

    const registry = await readKnowledgePoints()
    const order = new Map(registry.map((point) => [point.knowledgePointRef, point]))
    const nextPoints = pending.rows
      .map((entry) => order.get(entry.knowledge_point_ref))
      .filter((point) => point !== undefined && point.teachingOrder !== null)
      .sort((left, right) => left!.teachingOrder! - right!.teachingOrder!)
      .slice(0, 3)
      .map((point) => ({ knowledgePointRef: point!.knowledgePointRef, labelJa: point!.labelJa }))

    return {
      examDate: row.exam_date,
      daysRemaining: row.days_remaining === null ? null : Number(row.days_remaining),
      dailyTarget: 19,
      teachablePoints: Number(row.teachable),
      startedPoints: Number(row.started),
      steadyPoints: Number(row.steady),
      nextPoints,
      scopePoints: registry.filter((point) => point.status !== 'blocked').length,
    }
  }

  // 見た目の店。目録と所持と残高をひとつの応答にまとめます。
  // 「買えない」を画面で言えるように、残高との比較もここで済ませます。
  async getCosmeticShop(studentId: string): Promise<CosmeticShopResponse> {
    const rows = await this.pool.query<{
      code: string; kind: CosmeticItemDto['kind']; display_name: string; price: number
      owned: boolean; equipped: boolean; activity_coins: number
    }>(`
      SELECT ci.code, ci.kind, ci.display_name, ci.price,
             (sc.student_id IS NOT NULL) AS owned,
             COALESCE(sc.equipped, false) AS equipped,
             COALESCE(gs.activity_coins, 0) AS activity_coins
      FROM cosmetic_items ci
      LEFT JOIN student_cosmetics sc ON sc.code = ci.code AND sc.student_id = $1
      LEFT JOIN student_game_state gs ON gs.student_id = $1
      ORDER BY ci.sort_order
    `, [studentId])
    const activityCoins = rows.rows[0] ? Number(rows.rows[0].activity_coins) : 0
    return {
      activityCoins,
      items: rows.rows.map((row) => ({
        code: row.code,
        kind: row.kind,
        displayName: row.display_name,
        price: row.price,
        owned: row.owned,
        equipped: row.equipped,
        affordable: !row.owned && activityCoins >= row.price,
      })),
    }
  }

  async purchaseCosmetic(studentId: string, code: string): Promise<CosmeticPurchaseResponse> {
    const result = await this.pool.query<{ purchase_cosmetic: CosmeticPurchaseOutcome }>(
      'SELECT purchase_cosmetic($1, $2) AS purchase_cosmetic', [studentId, code],
    )
    return { outcome: result.rows[0]!.purchase_cosmetic, shop: await this.getCosmeticShop(studentId) }
  }

  async equipCosmetic(studentId: string, code: string): Promise<CosmeticPurchaseResponse | null> {
    const result = await this.pool.query<{ equip_cosmetic: string }>(
      'SELECT equip_cosmetic($1, $2) AS equip_cosmetic', [studentId, code],
    )
    if (result.rows[0]!.equip_cosmetic === 'not_owned') return null
    return { outcome: 'purchased', shop: await this.getCosmeticShop(studentId) }
  }

  async getExamDate(studentId: string): Promise<ExamDateResponse> {
    const result = await this.pool.query<{ exam_date: string | null; days_remaining: number | null }>(`
      SELECT exam_date::text,
             CASE WHEN exam_date IS NULL THEN NULL
                  ELSE exam_date - (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date END AS days_remaining
      FROM users WHERE id = $1
    `, [studentId])
    const row = result.rows[0]
    return { examDate: row?.exam_date ?? null, daysRemaining: row?.days_remaining ?? null }
  }

  async setExamDate(studentId: string, examDate: string | null): Promise<ExamDateResponse | null> {
    const updated = await this.pool.query(
      "UPDATE users SET exam_date = $2::date WHERE id = $1 AND role = 'student' AND deleted_at IS NULL RETURNING id",
      [studentId, examDate],
    )
    if (!updated.rows[0]) return null
    // 復習予定は次の解答から新しい試験日で計算されます。
    // 既存行を書き直さないのは、投影がトリガで導出されるためです。
    return this.getExamDate(studentId)
  }
}

export class MemoryStudentRepository implements StudentRepository, AuthUserResolver {
  private readonly students = new Map<string, StudentRecord>()
  private readonly authIdentities = new Map<string, AuthUser>()
  private readonly guardianIds = new Set<string>()
  private readonly consents = new Map<string, ConsentRecord>()
  private readonly trialRedemptions = new Set<string>()
  private readonly trialAttempts = new Map<string, TrialAttemptRecord>()
  private readonly stageAttempts = new Map<string, StartStageAttemptResponse>()
  private readonly currentDevices = new Map<string, CurrentDeviceRegistrationResponse>()
  private readonly paymentWebhookEvents = new Map<string, string>()
  private readonly entitlements = new Map<string, { studentId: string; entitlementCode: string; status: SubscriptionEntitlementStatus; validUntil: Date | null }>()
  private readonly gameStates = new Map<string, StudentGameStateResponse>()
  private readonly gameRewardSources = new Set<string>()
  private readonly guardianInviteStudentIds = new Map<string, { studentId: string; expiresAt: Date }>()
  private readonly voiceConsentAuditEvents: Array<{ studentId: string; guardianId: string | null; status: Exclude<ConsentStatus, 'missing' | 'outdated'>; version: string }> = []
  private readonly voiceDataDeletionJobs: Array<{ studentId: string; guardianId: string | null; reason: 'voice_consent_withdrawn'; status: 'pending' }> = []

  async create(student: StudentRecord): Promise<void> {
    this.students.set(student.id, student)
  }

  async createWithAuthIdentity(student: StudentRecord, provider: AuthProvider, providerSubject: string): Promise<CreateStudentWithAuthIdentityResult> {
    const key = `${provider}:${providerSubject}`
    if (this.authIdentities.has(key)) return { status: 'identity_conflict' }
    this.students.set(student.id, student)
    this.authIdentities.set(key, { id: student.id, role: 'student' })
    return { status: 'created' }
  }

  async createDemoGuardian(guardianId: string): Promise<void> {
    this.guardianIds.add(guardianId)
    this.students.set(guardianId, { id: guardianId, birthMonth: '1970-01', isMinor: false, guardianLinkStatus: 'not_required', guardianId: null })
  }

  async createDemoAuthIdentity(userId: string, provider: AuthProvider, providerSubject: string): Promise<void> {
    const role = this.guardianIds.has(userId) ? 'guardian' : 'student'
    this.authIdentities.set(`${provider}:${providerSubject}`, { id: userId, role })
  }

  async resolve(_issuer: string, providerSubject: string): Promise<AuthUser | null> {
    return this.authIdentities.get(`email_magic_link:${providerSubject}`) ?? null
  }

  async findById(id: string): Promise<StudentRecord | null> {
    return this.students.get(id) ?? null
  }

  async createGuardianInvite(input: CreateGuardianInviteInput): Promise<GuardianInvitationResponse | null> {
    const student = this.students.get(input.studentId)
    if (!student || student.guardianLinkStatus !== 'pending') return null
    this.guardianInviteStudentIds.set(input.inviteCodeHash, { studentId: input.studentId, expiresAt: input.expiresAt })
    return { inviteCode: input.inviteCode, expiresAt: input.expiresAt.toISOString() }
  }

  async verifyGuardianInvite(input: VerifyGuardianInviteInput): Promise<GuardianLinkVerificationResponse | null> {
    const invite = this.guardianInviteStudentIds.get(input.inviteCodeHash)
    if (!invite || invite.expiresAt <= input.verifiedAt) return null
    const student = this.students.get(invite.studentId)
    if (!student || student.guardianLinkStatus !== 'pending') return null
    this.guardianInviteStudentIds.delete(input.inviteCodeHash)
    this.students.set(invite.studentId, { ...student, guardianLinkStatus: 'verified', guardianId: input.guardianId })
    this.applyMemoryGameReward(invite.studentId, {
      source: 'guardian_verification',
      sourceRef: input.guardianId,
      reason: 'guardian_link_verified',
      xpAwarded: 20,
      activityCoinsAwarded: 0,
      questStepDelta: 0,
      questChapterUnlocked: null,
      badgesAwarded: ['guardian_shield'],
    }, input.verifiedAt)
    return { studentId: invite.studentId, status: 'verified', purchaseAllowed: true, verifiedAt: input.verifiedAt.toISOString() }
  }

  async getVoiceConsent(studentId: string, requiredVersion: string): Promise<ConsentRecord> {
    const consent = this.consents.get(studentId)
    if (!consent) return { status: 'missing', version: null }
    if (consent.status === 'granted' && consent.version !== requiredVersion) return { ...consent, status: 'outdated' }
    return consent
  }

  async setVoiceConsent(studentId: string, guardianId: string | null, status: Exclude<ConsentStatus, 'missing' | 'outdated'>, version: string): Promise<ConsentRecord> {
    const consent = { status, version }
    this.consents.set(studentId, consent)
    this.voiceConsentAuditEvents.push({ studentId, guardianId, status, version })
    if (status === 'withdrawn') this.voiceDataDeletionJobs.push({ studentId, guardianId, reason: 'voice_consent_withdrawn', status: 'pending' })
    return consent
  }

  getVoiceConsentAuditEventsForTest() {
    return [...this.voiceConsentAuditEvents]
  }

  getVoiceDataDeletionJobsForTest() {
    return [...this.voiceDataDeletionJobs]
  }

  async listActiveEntitlements(studentId: string, asOf: Date): Promise<string[]> {
    return [...this.entitlements.values()]
      .filter((entitlement) => entitlement.studentId === studentId)
      .filter((entitlement) => entitlement.status === 'active' || entitlement.status === 'grace_period')
      .filter((entitlement) => entitlement.validUntil === null || entitlement.validUntil > asOf)
      .map((entitlement) => entitlement.entitlementCode)
      .sort()
  }

  async getStudentGameState(studentId: string): Promise<StudentGameStateResponse> {
    return this.ensureMemoryGameState(studentId, new Date())
  }

  private ensureMemoryGameState(studentId: string, updatedAt: Date): StudentGameStateResponse {
    const existing = this.gameStates.get(studentId)
    if (existing) return existing
    const created = {
      studentId,
      totalXp: 0,
      activityCoins: 0,
      questChapter: 0,
      questStep: 0,
      badges: [],
      updatedAt: updatedAt.toISOString(),
    }
    this.gameStates.set(studentId, created)
    return created
  }

  private applyMemoryGameReward(studentId: string, reward: GameRewardGrantDto, awardedAt: Date): GameRewardGrantDto {
    const rewardKey = `${studentId}:${reward.source}:${reward.sourceRef}`
    if (this.gameRewardSources.has(rewardKey)) return { ...reward, xpAwarded: 0, activityCoinsAwarded: 0, questStepDelta: 0, questChapterUnlocked: null, badgesAwarded: [] }
    this.gameRewardSources.add(rewardKey)
    const state = this.ensureMemoryGameState(studentId, awardedAt)
    const badges = new Set([...state.badges, ...reward.badgesAwarded])
    this.gameStates.set(studentId, {
      ...state,
      totalXp: state.totalXp + reward.xpAwarded,
      activityCoins: state.activityCoins + reward.activityCoinsAwarded,
      questChapter: Math.max(state.questChapter, reward.questChapterUnlocked ?? 0),
      questStep: state.questStep + reward.questStepDelta,
      badges: [...badges].sort(),
      updatedAt: awardedAt.toISOString(),
    })
    return reward
  }

  async processPaymentWebhook(input: ProcessPaymentWebhookInput): Promise<PaymentWebhookProcessResult> {
    const eventKey = `${input.provider}:${input.externalEventId}`
    const existingHash = this.paymentWebhookEvents.get(eventKey)
    if (existingHash !== undefined) return existingHash === input.payloadHash ? { status: 'duplicate' } : { status: 'payload_mismatch' }
    this.paymentWebhookEvents.set(eventKey, input.payloadHash)
    const student = this.students.get(input.studentId)
    if (!student || student.guardianId !== input.purchaserGuardianId || student.guardianLinkStatus !== 'verified') return { status: 'invalid_guardian_link' }
    const entitlementKey = `web_checkout:${input.externalSubscriptionId}:${input.entitlementCode}`
    this.entitlements.set(entitlementKey, {
      studentId: input.studentId,
      entitlementCode: input.entitlementCode,
      status: input.status,
      validUntil: input.validUntil,
    })
    return { status: 'processed' }
  }

  async upsertCurrentDevice(input: UpsertCurrentDeviceInput): Promise<CurrentDeviceRegistrationResponse> {
    const device = { platform: input.platform, pushEnabled: false, lastSeenAt: input.lastSeenAt.toISOString() }
    this.currentDevices.set(`${input.studentId}:${input.deviceIdHash}`, device)
    return device
  }

  async disableCurrentDevicePush(input: UpsertCurrentDeviceInput): Promise<CurrentDeviceRegistrationResponse | null> {
    const key = `${input.studentId}:${input.deviceIdHash}`
    if (!this.currentDevices.has(key)) return null
    const device = { platform: input.platform, pushEnabled: false, lastSeenAt: input.lastSeenAt.toISOString() }
    this.currentDevices.set(key, device)
    return device
  }

  async startTrial(studentId: string, attemptId: string, expiresAt: Date): Promise<TrialStartResult> {
    if (this.trialRedemptions.has(studentId)) return { status: 'redeemed' }
    this.trialRedemptions.add(studentId)
    const attempt = { id: attemptId, studentId, currentIndex: 0, score: 0, expiresAt }
    this.trialAttempts.set(attemptId, attempt)
    return { status: 'created', attempt }
  }

  async findTrialAttempt(attemptId: string): Promise<TrialAttemptRecord | null> {
    return this.trialAttempts.get(attemptId) ?? null
  }

  async advanceTrialAttempt(attemptId: string, expectedIndex: number, correct: boolean): Promise<TrialAttemptRecord | null> {
    const attempt = this.trialAttempts.get(attemptId)
    if (!attempt || attempt.currentIndex !== expectedIndex) return null
    const advanced = { ...attempt, currentIndex: attempt.currentIndex + 1, score: attempt.score + (correct ? 1 : 0) }
    this.trialAttempts.set(attemptId, advanced)
    return advanced
  }

  async completeTrialAttempt(attemptId: string): Promise<void> {
    this.trialAttempts.delete(attemptId)
  }

  async startStageAttempt(input: StartStageAttemptInput): Promise<StageAttemptStartResult> {
    void input
    return { status: 'exam_not_available' }
  }

  async findStageAttempt(studentId: string, attemptId: string): Promise<StartStageAttemptResponse | null> {
    const attempt = this.stageAttempts.get(attemptId)
    return attempt && attempt.attemptId === attemptId && studentId.length > 0 ? attempt : null
  }

  async submitStageAttempt(input: SubmitStageAttemptInput): Promise<StageAttemptSubmitResult> {
    void input
    return { status: 'attempt_not_found' }
  }

  async findStageAttemptResult(studentId: string, attemptId: string): Promise<StageAttemptResultResponse | null> {
    void studentId
    void attemptId
    return null
  }

  async listStudentKnowledgeProjections(studentId: string): Promise<StudentKnowledgeProjectionDto[]> {
    void studentId
    return []
  }

  async getDailyPlan(studentId: string): Promise<DailyPlanResponse> {
    void studentId
    return {
      sessionDate: new Date().toISOString().slice(0, 10), lives: 5, maxLives: 5, supportMode: false,
      nextLifeAt: null, reviewCap: 20, session: null,
      streak: { days: 0, countedToday: false, freezeAvailable: true, lastStudyDate: null },
    }
  }

  async startDailySession(studentId: string): Promise<DailySessionStartResponse | null> {
    void studentId
    return null
  }

  async getDailyHint(studentId: string, sessionId: string, contentItemId: string): Promise<DailyHintResponse | null> {
    void studentId
    void sessionId
    void contentItemId
    return null
  }

  async submitDailyAnswer(input: { studentId: string; sessionId: string; contentItemId: string; response: string | string[] | null; timedOut: boolean }): Promise<DailyAnswerResponse | null> {
    void input
    return null
  }

  // インメモリ実装は署名を満たすだけです。見た目の店は Postgres の関数が本体なので、
  // ここで真似ると二つの真実ができます。
  async getStudyPlan(studentId: string): Promise<StudyPlanResponse> {
    void studentId
    return {
      examDate: null, daysRemaining: null, dailyTarget: 19,
      teachablePoints: 0, startedPoints: 0, steadyPoints: 0, nextPoints: [], scopePoints: 0,
    }
  }

  async getCosmeticShop(studentId: string): Promise<CosmeticShopResponse> {
    void studentId
    return { activityCoins: 0, items: [] }
  }

  async purchaseCosmetic(studentId: string, code: string): Promise<CosmeticPurchaseResponse> {
    void studentId
    void code
    return { outcome: 'unknown_item', shop: { activityCoins: 0, items: [] } }
  }

  async equipCosmetic(studentId: string, code: string): Promise<CosmeticPurchaseResponse | null> {
    void studentId
    void code
    return null
  }

  async getExamDate(studentId: string): Promise<ExamDateResponse> {
    void studentId
    return { examDate: null, daysRemaining: null }
  }

  async setExamDate(studentId: string, examDate: string | null): Promise<ExamDateResponse | null> {
    void studentId
    void examDate
    return null
  }
}
