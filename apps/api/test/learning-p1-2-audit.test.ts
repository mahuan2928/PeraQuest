import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { PostgresLearningAuditRepository } from '../src/learning-audit-repository.js'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'

const databases: PGlite[] = []
const temporaryDirectories: string[] = []

const asMigrationDatabase = (database: PGlite): MigrationDatabase => ({
  query: async <Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
    if (parameters === undefined && sql.split(';').filter((statement) => statement.trim().length > 0).length > 1) {
      const results = await database.exec(sql)
      return { rows: (results.at(-1)?.rows ?? []) as Row[] }
    }
    const result = await database.query<Row>(sql, parameters)
    return { rows: result.rows }
  },
})

const ids = {
  studentA: '00000000-0000-0000-0000-000000001001',
  studentB: '00000000-0000-0000-0000-000000001002',
  guardianA: '00000000-0000-0000-0000-000000001003',
  admin: '00000000-0000-0000-0000-000000001004',
  exam: '00000000-0000-0000-0000-000000001101',
  version: '00000000-0000-0000-0000-000000001102',
  item: '00000000-0000-0000-0000-000000001103',
  optionA: '00000000-0000-0000-0000-000000001104',
  optionB: '00000000-0000-0000-0000-000000001105',
  attemptA: '00000000-0000-0000-0000-000000001201',
  attemptB: '00000000-0000-0000-0000-000000001202',
  eventA: '00000000-0000-0000-0000-000000001301',
}

const createDatabase = async (): Promise<PGlite> => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  return database
}

const seedAttempts = async (database: PGlite): Promise<void> => {
  await database.exec(`
    INSERT INTO users (id, role, is_minor) VALUES
      ('${ids.studentA}', 'student', false),
      ('${ids.studentB}', 'student', false),
      ('${ids.guardianA}', 'guardian', false),
      ('${ids.admin}', 'admin', false);
    INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES
      ('00000000-0000-0000-0000-000000001011', '${ids.studentA}', 'email_magic_link', 'student-a-sub'),
      ('00000000-0000-0000-0000-000000001012', '${ids.studentB}', 'email_magic_link', 'student-b-sub'),
      ('00000000-0000-0000-0000-000000001013', '${ids.guardianA}', 'google', 'guardian-a-sub'),
      ('00000000-0000-0000-0000-000000001014', '${ids.admin}', 'apple', 'admin-sub');
    INSERT INTO guardian_links (id, student_id, guardian_id, status, verified_at)
      VALUES ('00000000-0000-0000-0000-000000001021', '${ids.studentA}', '${ids.guardianA}', 'verified', CURRENT_TIMESTAMP);
    INSERT INTO stage_exams (id, exam_level, stage, code)
      VALUES ('${ids.exam}', 'eiken_grade_3', 1, 'audit-stage');
    INSERT INTO stage_exam_versions
      (id, exam_id, version, pass_score, duration_seconds, content_hash)
      VALUES ('${ids.version}', '${ids.exam}', 1, 0.8, 1200, decode(repeat('ab', 32), 'hex'));
    INSERT INTO stage_exam_items (id, exam_version_id, item_ref, ordinal, prompt, points)
      VALUES ('${ids.item}', '${ids.version}', 'item-1', 1, 'Choose one.', 1);
    INSERT INTO stage_exam_item_options (id, item_id, option_ref, option_text, ordinal) VALUES
      ('${ids.optionA}', '${ids.item}', 'a', 'Alpha', 1),
      ('${ids.optionB}', '${ids.item}', 'b', 'Beta', 2);
    INSERT INTO stage_exam_item_answer_keys (item_id, correct_option_id)
      VALUES ('${ids.item}', '${ids.optionA}');
    UPDATE stage_exam_versions
      SET status = 'published', published_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.version}';
    INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at) VALUES
      ('${ids.attemptA}', '${ids.studentA}', '${ids.version}', CURRENT_TIMESTAMP + interval '20 minutes'),
      ('${ids.attemptB}', '${ids.studentB}', '${ids.version}', CURRENT_TIMESTAMP + interval '20 minutes');
  `)
}

interface StartedEventOverrides {
  eventId: string
  actorId: string
  actorRole: 'student' | 'guardian' | 'admin'
  actorAuthProvider: 'apple' | 'google' | 'email_magic_link'
  actorProviderSubject: string
  actorRelationship: 'self' | 'verified_guardian' | 'admin'
  studentId: string
  attemptId: string
  requestId: string
  reason: string
}

const insertStartedEvent = (database: PGlite, overrides: Partial<StartedEventOverrides> = {}): Promise<unknown> => database.query(`
  INSERT INTO learning_audit_events
    (event_id, event_type, actor_id, actor_role, actor_auth_provider,
     actor_provider_subject, actor_relationship, student_id, attempt_id,
     request_id, reason, occurred_at)
  SELECT $1, 'attempt_started', $2, $3, $4, $5, $6, $7, attempts.id,
         $9, $10, attempts.started_at
  FROM stage_attempts attempts
  WHERE attempts.id = $8
`, [
  overrides.eventId ?? ids.eventA,
  overrides.actorId ?? ids.studentA,
  overrides.actorRole ?? 'student',
  overrides.actorAuthProvider ?? 'email_magic_link',
  overrides.actorProviderSubject ?? 'student-a-sub',
  overrides.actorRelationship ?? 'self',
  overrides.studentId ?? ids.studentA,
  overrides.attemptId ?? ids.attemptA,
  overrides.requestId ?? 'request-audit-1',
  overrides.reason ?? 'formal_assessment_started',
])

afterEach(async () => {
  await Promise.all(databases.map((database) => database.close()))
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })))
  databases.length = 0
  temporaryDirectories.length = 0
})

describe('learning P1.2 audit migration', () => {
  it('upgrades an existing P1.1 database and remains idempotent', async () => {
    const database = new PGlite()
    databases.push(database)
    const baselineDirectory = await mkdtemp(join(tmpdir(), 'peraquest-p1-1-migrations-'))
    temporaryDirectories.push(baselineDirectory)
    for (const name of [
      '0001_identity_guardian_consent.sql',
      '0002_one_time_trial.sql',
      '0004_learning_p1_1_idempotency.sql',
    ]) {
      await writeFile(join(baselineDirectory, name), await readFile(resolve(process.cwd(), 'migrations', name)))
    }

    await runMigrations(asMigrationDatabase(database), baselineDirectory)
    await seedAttempts(database)
    await expect(runMigrations(asMigrationDatabase(database))).resolves.toEqual([
      '0005_learning_audit.sql',
      '0006_learning_p1_3_1_stage_attempt_snapshot.sql',
      '0007_learning_p1_3_3_submit_grading.sql',
      '0008_learning_p1_3_4_terminal_audit.sql',
      '0009_learning_p1_3_5_knowledge_evidence.sql',
      '0010_learning_p1_3_6_mastery_due.sql',
      '0011_guardian_invitation.sql',
      '0012_student_knowledge_concurrent_timestamp.sql',
      '0013_voice_consent_withdrawal_jobs.sql',
      '0014_payment_webhook_events.sql',
      '0015_game_rewards_mvp.sql',
      '0016_content_items_licence_ledger.sql',
      '0017_daily_loop_and_lives.sql',
    ])
    await expect(runMigrations(asMigrationDatabase(database))).resolves.toEqual([])
    const backfilled = await database.query<{ attempts: number; snapshots: number; missing_hashes: number }>(`
      SELECT
        (SELECT count(*)::int FROM stage_attempts) AS attempts,
        (SELECT count(*)::int FROM stage_attempt_item_snapshots) AS snapshots,
        (SELECT count(*)::int FROM stage_attempts WHERE snapshot_hash IS NULL OR snapshot_created_at IS NULL) AS missing_hashes
    `)
    expect(backfilled.rows).toEqual([{ attempts: 2, snapshots: 2, missing_hashes: 0 }])
    await expect(insertStartedEvent(database)).resolves.toBeDefined()
  })

  it('rolls the P1.2 migration back when a later migration fails', async () => {
    const database = new PGlite()
    databases.push(database)
    const baselineDirectory = await mkdtemp(join(tmpdir(), 'peraquest-p1-1-baseline-'))
    const failingDirectory = await mkdtemp(join(tmpdir(), 'peraquest-p1-2-failing-'))
    temporaryDirectories.push(baselineDirectory, failingDirectory)
    for (const name of [
      '0001_identity_guardian_consent.sql',
      '0002_one_time_trial.sql',
      '0004_learning_p1_1_idempotency.sql',
    ]) {
      await writeFile(join(baselineDirectory, name), await readFile(resolve(process.cwd(), 'migrations', name)))
    }
    await runMigrations(asMigrationDatabase(database), baselineDirectory)
    await writeFile(
      join(failingDirectory, '0005_learning_audit.sql'),
      await readFile(resolve(process.cwd(), 'migrations/0005_learning_audit.sql')),
    )
    await writeFile(join(failingDirectory, '0006_forced_failure.sql'), 'SELECT * FROM deliberately_missing_table;\n')

    await expect(runMigrations(asMigrationDatabase(database), failingDirectory)).rejects.toThrow()
    const state = await database.query<{ audit_table: string | null; audit_type: string | null; ledger_count: number }>(`
      SELECT to_regclass('learning_audit_events')::text AS audit_table,
             to_regtype('learning_audit_event_type')::text AS audit_type,
             (SELECT count(*)::int FROM schema_migrations WHERE name = '0005_learning_audit.sql') AS ledger_count
    `)
    expect(state.rows).toEqual([{ audit_table: null, audit_type: null, ledger_count: 0 }])
  })

  it('provides an unregistered repository foundation with immutable actor snapshots', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    const repository = new PostgresLearningAuditRepository(asMigrationDatabase(database))

    const event = await repository.append({
      eventId: ids.eventA,
      eventType: 'attempt_started',
      actorId: ids.studentA,
      actorRole: 'student',
      actorAuthProvider: 'email_magic_link',
      actorProviderSubject: 'student-a-sub',
      actorRelationship: 'self',
      studentId: ids.studentA,
      attemptId: ids.attemptA,
      requestId: 'request-audit-1',
      reason: 'formal_assessment_started',
    })

    expect(event).toMatchObject({
      eventId: ids.eventA,
      actorRole: 'student',
      actorAuthProvider: 'email_magic_link',
      actorProviderSubject: 'student-a-sub',
      actorRelationship: 'self',
    })
    await database.query("UPDATE users SET role = 'guardian' WHERE id = $1", [ids.studentA])
    await database.query("UPDATE auth_identities SET provider_subject = 'changed-sub' WHERE user_id = $1", [ids.studentA])
    const snapshot = await database.query(`
      SELECT actor_role, actor_auth_provider, actor_provider_subject, actor_relationship
      FROM learning_audit_events WHERE event_id = $1
    `, [ids.eventA])
    expect(snapshot.rows).toEqual([{
      actor_role: 'student',
      actor_auth_provider: 'email_magic_link',
      actor_provider_subject: 'student-a-sub',
      actor_relationship: 'self',
    }])
  })

  it('uses authoritative terminal attempt times when appending submitted and expired audit events', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    const repository = new PostgresLearningAuditRepository(asMigrationDatabase(database))
    const snapshot = await database.query<{ item_snapshot_id: string; correct_option_snapshot_id: string }>(`
      SELECT item.id AS item_snapshot_id, keys.correct_option_snapshot_id
      FROM stage_attempt_item_snapshots item
      JOIN stage_attempt_answer_key_snapshots keys ON keys.item_snapshot_id = item.id
      WHERE item.attempt_id = $1
    `, [ids.attemptA])
    await database.query(`
      INSERT INTO stage_attempt_answers
        (attempt_id, item_snapshot_id, answer_status, selected_option_snapshot_id, idempotency_key)
      VALUES ($1, $2, 'answered', $3, 'submit-1')
    `, [ids.attemptA, snapshot.rows[0]!.item_snapshot_id, snapshot.rows[0]!.correct_option_snapshot_id])
    await database.query(`
      UPDATE stage_attempts
      SET status = 'passed', submitted_at = CURRENT_TIMESTAMP, score = 1, passed = true,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [ids.attemptA])
    const submitted = await repository.append({
      eventId: '00000000-0000-0000-0000-000000001361',
      eventType: 'attempt_submitted',
      actorId: ids.studentA,
      actorRole: 'student',
      actorAuthProvider: 'email_magic_link',
      actorProviderSubject: 'student-a-sub',
      actorRelationship: 'self',
      studentId: ids.studentA,
      attemptId: ids.attemptA,
      requestId: 'request-audit-61',
      reason: 'stage_attempt_submitted',
    })
    const submittedAttempt = await database.query<{ submitted_at: Date }>('SELECT submitted_at FROM stage_attempts WHERE id = $1', [ids.attemptA])
    expect(submitted.occurredAt.toISOString()).toBe(submittedAttempt.rows[0]!.submitted_at.toISOString())

    await database.query('ALTER TABLE stage_attempts DISABLE TRIGGER stage_attempt_transition_trg')
    await database.query(`
      UPDATE stage_attempts
      SET started_at = CURRENT_TIMESTAMP - interval '2 hours',
          expires_at = CURRENT_TIMESTAMP - interval '1 hour'
      WHERE id = $1
    `, [ids.attemptB])
    await database.query('ALTER TABLE stage_attempts ENABLE TRIGGER stage_attempt_transition_trg')
    await database.query(`
      UPDATE stage_attempts
      SET status = 'expired', expired_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [ids.attemptB])
    const expired = await repository.append({
      eventId: '00000000-0000-0000-0000-000000001362',
      eventType: 'attempt_expired',
      actorId: ids.studentB,
      actorRole: 'student',
      actorAuthProvider: 'email_magic_link',
      actorProviderSubject: 'student-b-sub',
      actorRelationship: 'self',
      studentId: ids.studentB,
      attemptId: ids.attemptB,
      requestId: 'request-audit-62',
      reason: 'stage_attempt_expired',
    })
    const expiredAttempt = await database.query<{ expired_at: Date }>('SELECT expired_at FROM stage_attempts WHERE id = $1', [ids.attemptB])
    expect(expired.occurredAt.toISOString()).toBe(expiredAttempt.rows[0]!.expired_at.toISOString())
  })

  it('rejects open-attempt terminal events and forged authoritative times through direct SQL', async () => {
    const database = await createDatabase()
    await seedAttempts(database)

    await expect(database.query(`
      INSERT INTO learning_audit_events
        (event_id, event_type, actor_id, actor_role, actor_auth_provider, actor_provider_subject,
         actor_relationship, student_id, attempt_id, request_id, reason, occurred_at)
      SELECT '00000000-0000-0000-0000-000000001311', 'attempt_submitted', student_id,
             'student', 'email_magic_link', 'student-a-sub', 'self', student_id, id,
             'request-audit-11', 'forged submission', CURRENT_TIMESTAMP
      FROM stage_attempts WHERE id = $1
    `, [ids.attemptA])).rejects.toThrow(/attempt_submitted must match/)
    await expect(database.query(`
      INSERT INTO learning_audit_events
        (event_id, event_type, actor_id, actor_role, actor_auth_provider, actor_provider_subject,
         actor_relationship, student_id, attempt_id, request_id, reason, occurred_at)
      SELECT '00000000-0000-0000-0000-000000001312', 'attempt_expired', student_id,
             'student', 'email_magic_link', 'student-a-sub', 'self', student_id, id,
             'request-audit-12', 'forged expiry', expires_at
      FROM stage_attempts WHERE id = $1
    `, [ids.attemptA])).rejects.toThrow(/attempt_expired must match/)
    await expect(database.query(`
      INSERT INTO learning_audit_events
        (event_id, event_type, actor_id, actor_role, actor_auth_provider, actor_provider_subject,
         actor_relationship, student_id, attempt_id, request_id, reason, occurred_at)
      SELECT '00000000-0000-0000-0000-000000001313', 'attempt_started', student_id,
             'student', 'email_magic_link', 'student-b-sub', 'self', student_id, id,
             'request-audit-13', 'forged time', started_at + interval '1 second'
      FROM stage_attempts WHERE id = $1
    `, [ids.attemptB])).rejects.toThrow(/authoritative started_at/)
  })

  it('rejects unrelated students and forged actor snapshots through direct SQL', async () => {
    const database = await createDatabase()
    await seedAttempts(database)

    await expect(insertStartedEvent(database, {
      actorId: ids.studentB,
      actorProviderSubject: 'student-b-sub',
    })).rejects.toThrow(/not attributed/)
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001321',
      actorRole: 'admin',
      requestId: 'request-audit-21',
    })).rejects.toThrow(/role snapshot/)
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001322',
      actorProviderSubject: 'forged-sub',
      requestId: 'request-audit-22',
    })).rejects.toThrow(/identity snapshot/)
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001323',
      actorRelationship: 'admin',
      requestId: 'request-audit-23',
    })).rejects.toThrow(/not attributed/)
  })

  it('accepts a verified guardian snapshot for the target and rejects it for another student', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    await expect(insertStartedEvent(database, {
      actorId: ids.guardianA,
      actorRole: 'guardian',
      actorAuthProvider: 'google',
      actorProviderSubject: 'guardian-a-sub',
      actorRelationship: 'verified_guardian',
    })).resolves.toBeDefined()
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001331',
      actorId: ids.guardianA,
      actorRole: 'guardian',
      actorAuthProvider: 'google',
      actorProviderSubject: 'guardian-a-sub',
      actorRelationship: 'verified_guardian',
      studentId: ids.studentB,
      attemptId: ids.attemptB,
      requestId: 'request-audit-31',
    })).rejects.toThrow(/not attributed/)
  })

  it('is append-only through UPDATE, DELETE, TRUNCATE, and actor snapshot tampering', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    await insertStartedEvent(database)

    await expect(database.query(
      'UPDATE learning_audit_events SET actor_role = $1 WHERE event_id = $2',
      ['admin', ids.eventA],
    )).rejects.toThrow(/append-only/)
    await expect(database.query(
      'DELETE FROM learning_audit_events WHERE event_id = $1',
      [ids.eventA],
    )).rejects.toThrow(/append-only/)
    await expect(database.query('TRUNCATE learning_audit_events')).rejects.toThrow(/append-only/)
  })

  it('enforces globally unique request ids across students', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    await insertStartedEvent(database)

    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001341',
      actorId: ids.studentB,
      actorProviderSubject: 'student-b-sub',
      studentId: ids.studentB,
      attemptId: ids.attemptB,
      requestId: 'request-audit-1',
    })).rejects.toThrow()
  })

  it('enforces request, reason, event uniqueness, attribution, and database time', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    await insertStartedEvent(database)

    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001351',
      requestId: 'request-audit-51',
    })).rejects.toThrow()
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001352',
      actorId: ids.studentB,
      actorProviderSubject: 'student-b-sub',
      studentId: ids.studentB,
      attemptId: ids.attemptB,
      requestId: 'short',
    })).rejects.toThrow()
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001353',
      actorId: ids.studentB,
      actorProviderSubject: 'student-b-sub',
      studentId: ids.studentB,
      attemptId: ids.attemptB,
      requestId: 'request-audit-53',
      reason: '   ',
    })).rejects.toThrow()
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001354',
      studentId: ids.studentB,
      requestId: 'request-audit-54',
    })).rejects.toThrow()
    await expect(database.query(`
      INSERT INTO learning_audit_events
        (event_id, event_type, actor_id, actor_role, actor_auth_provider, actor_provider_subject,
         actor_relationship, student_id, attempt_id, request_id, reason, occurred_at, recorded_at)
      SELECT '00000000-0000-0000-0000-000000001355', 'attempt_started', student_id,
             'student', 'email_magic_link', 'student-b-sub', 'self', student_id, id,
             'request-audit-55', 'forged recorded time', started_at, CURRENT_TIMESTAMP - interval '1 second'
      FROM stage_attempts WHERE id = $1
    `, [ids.attemptB])).rejects.toThrow(/database current time/)
  })
})
