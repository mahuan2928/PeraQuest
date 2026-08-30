import type { Pool } from 'pg'
import type { AuthProvider, ClientPlatform, ConsentStatus, CurrentDeviceRegistrationResponse, GuardianLinkStatus, KnowledgeEvidenceOutcome, StageAttemptResultResponse, StartStageAttemptResponse, StudentKnowledgeProjectionDto, UserRole } from '@peraquest/contracts'
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
export type StageAttemptStartResult =
  | { status: 'created' | 'replayed'; httpStatus: number; attempt: StartStageAttemptResponse }
  | { status: 'exam_not_available' | 'already_open' | 'request_in_progress' | 'key_reused' }
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

export interface StudentRepository {
  create(student: StudentRecord): Promise<void>
  findById(id: string): Promise<StudentRecord | null>
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
  listActiveEntitlements(studentId: string, asOf: Date): Promise<string[]>
  upsertCurrentDevice(input: UpsertCurrentDeviceInput): Promise<CurrentDeviceRegistrationResponse>
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
    SELECT ans.item_snapshot_id AS item_id, ans.outcome, ans.earned_score::text, ans.max_score::text
    FROM stage_attempt_answers ans
    JOIN stage_attempt_item_snapshots item ON item.id = ans.item_snapshot_id
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
    })),
  }
}

const readStudentKnowledgeProjections = async (database: Queryable, studentId: string): Promise<StudentKnowledgeProjectionDto[]> => {
  const result = await database.query<StudentKnowledgeProjectionRow>(`
    SELECT student_id, knowledge_point_ref, raw_correct_total::text, raw_attempt_total::text,
           mastery_score::text, state, last_occurred_at, due_at, updated_at
    FROM student_knowledge
    WHERE student_id = $1
    ORDER BY due_at ASC, knowledge_point_ref ASC
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
    updatedAt: toIso(row.updated_at),
  }))
}

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

  async getVoiceConsent(studentId: string, requiredVersion: string): Promise<ConsentRecord> {
    const result = await this.pool.query<{ status: Exclude<ConsentStatus, 'missing' | 'outdated'>; version: string }>('SELECT status, version FROM consent_records WHERE student_id = $1 AND consent_type = $2 ORDER BY created_at DESC LIMIT 1', [studentId, 'voice_processing'])
    const consent = result.rows[0]
    if (!consent) return { status: 'missing', version: null }
    if (consent.status === 'granted' && consent.version !== requiredVersion) return { ...consent, status: 'outdated' }
    return consent
  }

  async setVoiceConsent(studentId: string, guardianId: string | null, status: Exclude<ConsentStatus, 'missing' | 'outdated'>, version: string): Promise<ConsentRecord> {
    await this.pool.query(`INSERT INTO consent_records (id, student_id, guardian_id, consent_type, status, version, granted_at, withdrawn_at)
      VALUES (gen_random_uuid(), $1, $2, 'voice_processing', $3, $4, CASE WHEN $3::consent_status = 'granted' THEN now() END, CASE WHEN $3::consent_status = 'withdrawn' THEN now() END)`, [studentId, guardianId, status, version])
    return { status, version }
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
}

export class MemoryStudentRepository implements StudentRepository {
  private readonly students = new Map<string, StudentRecord>()
  private readonly consents = new Map<string, ConsentRecord>()
  private readonly trialRedemptions = new Set<string>()
  private readonly trialAttempts = new Map<string, TrialAttemptRecord>()
  private readonly stageAttempts = new Map<string, StartStageAttemptResponse>()

  async create(student: StudentRecord): Promise<void> {
    this.students.set(student.id, student)
  }

  async findById(id: string): Promise<StudentRecord | null> {
    return this.students.get(id) ?? null
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
    return consent
  }

  async listActiveEntitlements(studentId: string, asOf: Date): Promise<string[]> {
    void studentId
    void asOf
    return []
  }

  async upsertCurrentDevice(input: UpsertCurrentDeviceInput): Promise<CurrentDeviceRegistrationResponse> {
    return { platform: input.platform, pushEnabled: false, lastSeenAt: input.lastSeenAt.toISOString() }
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
}
