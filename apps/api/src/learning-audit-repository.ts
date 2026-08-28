export type LearningAuditEventType = 'attempt_started' | 'attempt_submitted' | 'attempt_expired'
export type LearningAuditActorRole = 'student' | 'guardian' | 'admin'
export type LearningAuditActorRelationship = 'self' | 'verified_guardian' | 'admin'
export type LearningAuditAuthProvider = 'apple' | 'google' | 'email_magic_link'

export interface LearningAuditEventInput {
  eventId: string
  eventType: LearningAuditEventType
  actorId: string
  actorRole: LearningAuditActorRole
  actorAuthProvider: LearningAuditAuthProvider
  actorProviderSubject: string
  actorRelationship: LearningAuditActorRelationship
  studentId: string
  attemptId: string
  requestId: string
  reason: string
}

export interface LearningAuditEventRecord extends LearningAuditEventInput {
  occurredAt: Date
  recordedAt: Date
}

interface QueryResultLike<Row> {
  rows: Row[]
}

export interface LearningAuditDatabase {
  query<Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<QueryResultLike<Row>>
}

interface LearningAuditRow extends Record<string, unknown> {
  event_id: string
  event_type: LearningAuditEventType
  actor_id: string
  actor_role: LearningAuditActorRole
  actor_auth_provider: LearningAuditAuthProvider
  actor_provider_subject: string
  actor_relationship: LearningAuditActorRelationship
  student_id: string
  attempt_id: string
  request_id: string
  reason: string
  occurred_at: Date
  recorded_at: Date
}

export interface LearningAuditRepository {
  append(event: LearningAuditEventInput): Promise<LearningAuditEventRecord>
}

export class PostgresLearningAuditRepository implements LearningAuditRepository {
  constructor(private readonly database: LearningAuditDatabase) {}

  async append(event: LearningAuditEventInput): Promise<LearningAuditEventRecord> {
    const result = await this.database.query<LearningAuditRow>(`
      INSERT INTO learning_audit_events
        (event_id, event_type, actor_id, actor_role, actor_auth_provider,
         actor_provider_subject, actor_relationship, student_id, attempt_id,
         request_id, reason, occurred_at)
      SELECT $1, $2, $3, $4, $5, $6, $7, $8, attempts.id, $10, $11,
             CASE $2::learning_audit_event_type
               WHEN 'attempt_started' THEN attempts.started_at
               WHEN 'attempt_submitted' THEN attempts.submitted_at
               WHEN 'attempt_expired' THEN attempts.expired_at
             END
      FROM stage_attempts attempts
      WHERE attempts.id = $9 AND attempts.student_id = $8
      RETURNING event_id, event_type, actor_id, actor_role, actor_auth_provider,
                actor_provider_subject, actor_relationship, student_id, attempt_id,
                request_id, reason, occurred_at, recorded_at
    `, [
      event.eventId,
      event.eventType,
      event.actorId,
      event.actorRole,
      event.actorAuthProvider,
      event.actorProviderSubject,
      event.actorRelationship,
      event.studentId,
      event.attemptId,
      event.requestId,
      event.reason,
    ])
    const row = result.rows[0]
    if (!row) throw new Error('Learning audit attempt was not found for the target student')
    return {
      eventId: row.event_id,
      eventType: row.event_type,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      actorAuthProvider: row.actor_auth_provider,
      actorProviderSubject: row.actor_provider_subject,
      actorRelationship: row.actor_relationship,
      studentId: row.student_id,
      attemptId: row.attempt_id,
      requestId: row.request_id,
      reason: row.reason,
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at,
    }
  }
}
