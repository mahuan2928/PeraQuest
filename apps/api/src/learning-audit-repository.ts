export type LearningAuditEventType = 'attempt_started' | 'attempt_submitted' | 'attempt_expired'

export interface LearningAuditEventInput {
  eventId: string
  eventType: LearningAuditEventType
  actorId: string
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
        (event_id, event_type, actor_id, student_id, attempt_id, request_id, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING event_id, event_type, actor_id, student_id, attempt_id,
                request_id, reason, occurred_at, recorded_at
    `, [
      event.eventId,
      event.eventType,
      event.actorId,
      event.studentId,
      event.attemptId,
      event.requestId,
      event.reason,
    ])
    const row = result.rows[0]
    if (!row) throw new Error('Learning audit insert returned no row')
    return {
      eventId: row.event_id,
      eventType: row.event_type,
      actorId: row.actor_id,
      studentId: row.student_id,
      attemptId: row.attempt_id,
      requestId: row.request_id,
      reason: row.reason,
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at,
    }
  }
}
