import type { Pool } from 'pg'
import type { ConsentStatus, GuardianLinkStatus } from '@peraquest/contracts'

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

export interface StudentRepository {
  create(student: StudentRecord): Promise<void>
  findById(id: string): Promise<StudentRecord | null>
  getVoiceConsent(studentId: string, requiredVersion: string): Promise<ConsentRecord>
  setVoiceConsent(studentId: string, guardianId: string | null, status: Exclude<ConsentStatus, 'missing' | 'outdated'>, version: string): Promise<ConsentRecord>
  startTrial(studentId: string, attemptId: string, expiresAt: Date): Promise<TrialStartResult>
  findTrialAttempt(attemptId: string): Promise<TrialAttemptRecord | null>
  advanceTrialAttempt(attemptId: string, expectedIndex: number, correct: boolean): Promise<TrialAttemptRecord | null>
  completeTrialAttempt(attemptId: string): Promise<void>
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
}

export class MemoryStudentRepository implements StudentRepository {
  private readonly students = new Map<string, StudentRecord>()
  private readonly consents = new Map<string, ConsentRecord>()
  private readonly trialRedemptions = new Set<string>()
  private readonly trialAttempts = new Map<string, TrialAttemptRecord>()

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
}
