import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresAuthUserResolver, PostgresStudentRepository } from '../src/repository.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const databases: PGlite[] = []

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

describe('database migrations', () => {
  beforeEach(() => { vi.stubEnv('ALLOW_LEGACY_TEST_HEADERS', 'true') })

  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('applies the schema to an empty PostgreSQL database and is idempotent', async () => {
    const database = new PGlite()
    databases.push(database)
    const adapter = asMigrationDatabase(database)

    await expect(runMigrations(adapter)).resolves.toEqual([
      '0001_identity_guardian_consent.sql',
      '0002_one_time_trial.sql',
      '0004_learning_p1_1_idempotency.sql',
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
    await expect(runMigrations(adapter)).resolves.toEqual([])

    const tables = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      'auth_identities',
      'consent_records',
      'content_items',
      'daily_answers',
      'daily_sessions',
      'game_reward_ledger',
      'guardian_links',
      'idempotency_records',
      'knowledge_evidence',
      'learning_audit_events',
      'life_ledger',
      'line_links',
      'payment_webhook_events',
      'schema_migrations',
      'stage_attempt_answer_key_snapshots',
      'stage_attempt_answers',
      'stage_attempt_item_option_snapshots',
      'stage_attempt_item_snapshots',
      'stage_attempt_start_idempotency',
      'stage_attempts',
      'stage_exam_item_answer_keys',
      'stage_exam_item_options',
      'stage_exam_items',
      'stage_exam_version_retirements',
      'stage_exam_versions',
      'stage_exams',
      'student_game_state',
      'student_knowledge',
      'student_knowledge_applied_evidence',
      'student_lives',
      'subscription_entitlements',
      'trial_attempts',
      'trial_redemptions',
      'user_devices',
      'users',
      'voice_consent_audit_events',
      'voice_data_deletion_jobs',
    ])
  })

  it('resolves only active users in the configured provider namespace', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    await database.query(`INSERT INTO users (id, role, birth_month, is_minor, deleted_at) VALUES
      ('00000000-0000-0000-0000-000000000041', 'student', '2012-04-01', true, NULL),
      ('00000000-0000-0000-0000-000000000042', 'student', '2012-05-01', true, now()),
      ('00000000-0000-0000-0000-000000000043', 'guardian', NULL, false, NULL)`)
    await database.query(`INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES
      ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000041', 'email_magic_link', 'active-sub'),
      ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000042', 'email_magic_link', 'deleted-sub'),
      ('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000043', 'google', 'other-provider-sub')`)
    const pool = { query: database.query.bind(database) } as unknown as Pool
    const resolver = new PostgresAuthUserResolver(pool, 'email_magic_link')

    await expect(resolver.resolve('https://issuer.test', 'active-sub')).resolves.toEqual({ id: '00000000-0000-0000-0000-000000000041', role: 'student' })
    await expect(resolver.resolve('https://issuer.test', 'missing-sub')).resolves.toBeNull()
    await expect(resolver.resolve('https://issuer.test', 'deleted-sub')).resolves.toBeNull()
    await expect(resolver.resolve('https://issuer.test', 'other-provider-sub')).resolves.toBeNull()
  })

  it('creates a student and auth identity atomically through the PostgreSQL repository', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const client = { query: database.query.bind(database), release: () => undefined }
    const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
    const repository = new PostgresStudentRepository(pool)
    const resolver = new PostgresAuthUserResolver(pool, 'email_magic_link')

    const created = await repository.createWithAuthIdentity(
      { id: '00000000-0000-0000-0000-0000000000a1', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null },
      'email_magic_link',
      'new-student-sub',
    )

    expect(created).toEqual({ status: 'created' })
    await expect(resolver.resolve('https://issuer.test', 'new-student-sub')).resolves.toEqual({ id: '00000000-0000-0000-0000-0000000000a1', role: 'student' })
    await expect(repository.findById('00000000-0000-0000-0000-0000000000a1')).resolves.toMatchObject({ guardianLinkStatus: 'pending' })

    const duplicate = await repository.createWithAuthIdentity(
      { id: '00000000-0000-0000-0000-0000000000a2', birthMonth: '2012-05', isMinor: true, guardianLinkStatus: 'pending', guardianId: null },
      'email_magic_link',
      'new-student-sub',
    )
    expect(duplicate).toEqual({ status: 'identity_conflict' })
    await expect(repository.findById('00000000-0000-0000-0000-0000000000a2')).resolves.toBeNull()
  })

  it('stores only minimal redemption and short-lived trial state, not durable answers or scores', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const redemptionColumns = await database.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'trial_redemptions' ORDER BY column_name")
    expect(redemptionColumns.rows.map(({ column_name }) => column_name)).toEqual(['redeemed_at', 'student_id'])
    const attemptColumns = await database.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'trial_attempts' ORDER BY column_name")
    expect(attemptColumns.rows.map(({ column_name }) => column_name)).not.toContain('answers')

    const futureKnowledgeTables = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('remediation_tasks', 'unlock_states')
    `)
    expect(futureKnowledgeTables.rows).toEqual([])
  })

  it('enforces one-time redemption atomically through the PostgreSQL repository', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const client = { query: database.query.bind(database), release: () => undefined }
    const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
    const repository = new PostgresStudentRepository(pool)
    await repository.create({ id: '00000000-0000-0000-0000-000000000001', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    const results = await Promise.all([
      repository.startTrial('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', new Date(Date.now() + 60_000)),
      repository.startTrial('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', new Date(Date.now() + 60_000)),
    ])
    expect(results.map(({ status }) => status).sort()).toEqual(['created', 'redeemed'])
  })

  it('lists only active, unexpired subscription entitlements for the requested student', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const studentA = '00000000-0000-0000-0000-000000000061'
    const studentB = '00000000-0000-0000-0000-000000000062'
    const guardian = '00000000-0000-0000-0000-000000000063'
    await database.query(`
      INSERT INTO users (id, role, birth_month, is_minor)
      VALUES
        ($1, 'student', '2000-01-01', false),
        ($2, 'student', '2001-01-01', false),
        ($3, 'guardian', NULL, false)
    `, [studentA, studentB, guardian])
    await database.query(`
      INSERT INTO subscription_entitlements
        (id, student_id, purchaser_guardian_id, payment_channel, external_subscription_id,
         entitlement_code, status, valid_until)
      VALUES
        ('00000000-0000-0000-0000-000000000071', $1, $3, 'web_checkout', 'sub-active', 'premium_lesson_pack', 'active', NULL),
        ('00000000-0000-0000-0000-000000000072', $1, $3, 'apple_app_store', 'sub-grace', 'exam_grade_3_full', 'grace_period', TIMESTAMPTZ '2026-09-01 00:00:00+00'),
        ('00000000-0000-0000-0000-000000000073', $1, $3, 'google_play', 'sub-expired-status', 'expired_status', 'expired', NULL),
        ('00000000-0000-0000-0000-000000000074', $1, $3, 'web_checkout', 'sub-revoked', 'revoked_status', 'revoked', NULL),
        ('00000000-0000-0000-0000-000000000075', $1, $3, 'apple_app_store', 'sub-expired-date', 'expired_date', 'active', TIMESTAMPTZ '2026-08-01 00:00:00+00'),
        ('00000000-0000-0000-0000-000000000076', $2, $3, 'web_checkout', 'sub-other-student', 'other_student', 'active', NULL)
    `, [studentA, studentB, guardian])
    const client = { query: database.query.bind(database), release: () => undefined }
    const repository = new PostgresStudentRepository({ query: database.query.bind(database), connect: async () => client } as unknown as Pool)

    await expect(repository.listActiveEntitlements(studentA, new Date('2026-08-30T00:00:00.000Z'))).resolves.toEqual([
      'exam_grade_3_full',
      'premium_lesson_pack',
    ])
  })

  it('processes payment webhook events idempotently into subscription entitlements', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const client = { query: database.query.bind(database), release: () => undefined }
    const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
    const repository = new PostgresStudentRepository(pool)
    const studentId = '00000000-0000-0000-0000-0000000000b1'
    const guardianId = '00000000-0000-0000-0000-0000000000b2'
    await database.query(`
      INSERT INTO users (id, role, birth_month, is_minor)
      VALUES
        ($1, 'student', '2012-04-01', true),
        ($2, 'guardian', NULL, false)
    `, [studentId, guardianId])
    await database.query(`
      INSERT INTO guardian_links (id, student_id, guardian_id, status, verified_at)
      VALUES ('00000000-0000-0000-0000-0000000000b3', $1, $2, 'verified', CURRENT_TIMESTAMP)
    `, [studentId, guardianId])

    const processed = await repository.processPaymentWebhook({
      provider: 'web_checkout',
      externalEventId: 'evt-payment-1',
      eventType: 'subscription.active',
      payloadHash: 'hash-1',
      studentId,
      purchaserGuardianId: guardianId,
      externalSubscriptionId: 'sub-payment-1',
      entitlementCode: 'premium_practice',
      status: 'active',
      validUntil: new Date('2026-09-30T00:00:00Z'),
      receivedAt: new Date('2026-08-31T00:00:00Z'),
    })
    const duplicate = await repository.processPaymentWebhook({
      provider: 'web_checkout',
      externalEventId: 'evt-payment-1',
      eventType: 'subscription.active',
      payloadHash: 'hash-1',
      studentId,
      purchaserGuardianId: guardianId,
      externalSubscriptionId: 'sub-payment-1',
      entitlementCode: 'premium_practice',
      status: 'active',
      validUntil: new Date('2026-09-30T00:00:00Z'),
      receivedAt: new Date('2026-08-31T00:00:00Z'),
    })
    const payloadMismatch = await repository.processPaymentWebhook({
      provider: 'web_checkout',
      externalEventId: 'evt-payment-1',
      eventType: 'subscription.active',
      payloadHash: 'hash-2',
      studentId,
      purchaserGuardianId: guardianId,
      externalSubscriptionId: 'sub-payment-1',
      entitlementCode: 'premium_extra',
      status: 'active',
      validUntil: new Date('2026-09-30T00:00:00Z'),
      receivedAt: new Date('2026-08-31T00:00:00Z'),
    })

    expect(processed).toEqual({ status: 'processed' })
    expect(duplicate).toEqual({ status: 'duplicate' })
    expect(payloadMismatch).toEqual({ status: 'payload_mismatch' })
    await expect(repository.listActiveEntitlements(studentId, new Date('2026-08-31T00:00:00Z'))).resolves.toEqual(['premium_practice'])
  })

  it('upserts current device metadata without storing raw device ids', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const student = '00000000-0000-0000-0000-000000000081'
    await database.query("INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2000-01-01', false)", [student])
    const client = { query: database.query.bind(database), release: () => undefined }
    const repository = new PostgresStudentRepository({ query: database.query.bind(database), connect: async () => client } as unknown as Pool)

    await expect(repository.upsertCurrentDevice({
      studentId: student,
      platform: 'ios',
      deviceIdHash: '9c6f7ad1e2b4',
      appVersion: '1.0.0',
      osVersion: '18',
      lastSeenAt: new Date('2026-08-30T00:00:00.000Z'),
    })).resolves.toEqual({ platform: 'ios', pushEnabled: false, lastSeenAt: '2026-08-30T00:00:00.000Z' })
    await expect(repository.upsertCurrentDevice({
      studentId: student,
      platform: 'android',
      deviceIdHash: '9c6f7ad1e2b4',
      appVersion: '1.0.1',
      osVersion: '15',
      lastSeenAt: new Date('2026-08-31T00:00:00.000Z'),
    })).resolves.toEqual({ platform: 'android', pushEnabled: false, lastSeenAt: '2026-08-31T00:00:00.000Z' })

    const devices = await database.query<{ platform: string; device_id_hash: string; app_version: string; os_version: string; push_enabled: boolean; last_seen_at: Date }>(`
      SELECT platform, device_id_hash, app_version, os_version, push_enabled, last_seen_at
      FROM user_devices
      WHERE user_id = $1
    `, [student])
    expect(devices.rows).toEqual([{
      platform: 'android',
      device_id_hash: '9c6f7ad1e2b4',
      app_version: '1.0.1',
      os_version: '15',
      push_enabled: false,
      last_seen_at: new Date('2026-08-31T00:00:00.000Z'),
    }])
    expect(JSON.stringify(devices.rows)).not.toContain('device-1')
  })

  it('stores guardian invitation hashes and verifies pending guardian links', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const student = '00000000-0000-0000-0000-000000000084'
    const guardian = '00000000-0000-0000-0000-000000000085'
    await database.query(`
      INSERT INTO users (id, role, birth_month, is_minor) VALUES
        ($1, 'student', '2012-01-01', true),
        ($2, 'guardian', NULL, false)
    `, [student, guardian])
    await database.query("INSERT INTO guardian_links (id, student_id, status) VALUES ('00000000-0000-0000-0000-000000000086', $1, 'pending')", [student])
    const guardianClient = { query: database.query.bind(database), release: () => undefined }
    const repository = new PostgresStudentRepository({ query: database.query.bind(database), connect: async () => guardianClient } as unknown as Pool)

    await expect(repository.createGuardianInvite({
      studentId: student,
      inviteCode: 'rawInviteCode_123',
      inviteCodeHash: 'hashed-invite-code',
      expiresAt: new Date('2026-08-31T00:00:00.000Z'),
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
    })).resolves.toEqual({ inviteCode: 'rawInviteCode_123', expiresAt: '2026-08-31T00:00:00.000Z' })

    const pending = await database.query<{ invitation_code_hash: string; invitation_expires_at: Date; invitation_created_at: Date }>(`
      SELECT invitation_code_hash, invitation_expires_at, invitation_created_at
      FROM guardian_links
      WHERE student_id = $1
    `, [student])
    expect(pending.rows).toEqual([{
      invitation_code_hash: 'hashed-invite-code',
      invitation_expires_at: new Date('2026-08-31T00:00:00.000Z'),
      invitation_created_at: new Date('2026-08-30T00:00:00.000Z'),
    }])
    expect(JSON.stringify(pending.rows)).not.toContain('rawInviteCode_123')

    await expect(repository.verifyGuardianInvite({
      guardianId: guardian,
      inviteCodeHash: 'hashed-invite-code',
      verifiedAt: new Date('2026-08-30T01:00:00.000Z'),
    })).resolves.toEqual({
      studentId: student,
      status: 'verified',
      purchaseAllowed: true,
      verifiedAt: '2026-08-30T01:00:00.000Z',
    })

    const verified = await database.query<{ guardian_id: string; status: string; purchase_allowed: boolean; verified_at: Date }>(`
      SELECT guardian_id, status, purchase_allowed, verified_at
      FROM guardian_links
      WHERE student_id = $1
    `, [student])
    expect(verified.rows).toEqual([{
      guardian_id: guardian,
      status: 'verified',
      purchase_allowed: true,
      verified_at: new Date('2026-08-30T01:00:00.000Z'),
    }])
    await expect(repository.getStudentGameState(student)).resolves.toMatchObject({
      totalXp: 20,
      activityCoins: 0,
      questChapter: 0,
      questStep: 0,
      badges: ['guardian_shield'],
    })
    await expect(repository.verifyGuardianInvite({
      guardianId: guardian,
      inviteCodeHash: 'hashed-invite-code',
      verifiedAt: new Date('2026-08-30T02:00:00.000Z'),
    })).resolves.toBeNull()
  })

  it('disables current device push and clears any stored token envelope', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const student = '00000000-0000-0000-0000-000000000082'
    const deviceHash = '49a15b1ed7c9'
    await database.query("INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2000-01-01', false)", [student])
    await database.query(`
      INSERT INTO user_devices
        (id, user_id, platform, device_id_hash, app_version, os_version, push_token_encrypted, push_enabled, last_seen_at)
      VALUES
        ('00000000-0000-0000-0000-000000000083', $1, 'ios', $2, '1.0.0', '18', 'sealed-token', true, TIMESTAMPTZ '2026-08-29 00:00:00+00')
    `, [student, deviceHash])
    const repository = new PostgresStudentRepository({ query: database.query.bind(database) } as unknown as Pool)

    await expect(repository.disableCurrentDevicePush({
      studentId: student,
      platform: 'android',
      deviceIdHash: deviceHash,
      appVersion: '1.0.1',
      osVersion: '15',
      lastSeenAt: new Date('2026-08-30T00:00:00.000Z'),
    })).resolves.toEqual({ platform: 'android', pushEnabled: false, lastSeenAt: '2026-08-30T00:00:00.000Z' })

    const devices = await database.query<{ platform: string; app_version: string; os_version: string; push_token_encrypted: string | null; push_enabled: boolean; last_seen_at: Date }>(`
      SELECT platform, app_version, os_version, push_token_encrypted, push_enabled, last_seen_at
      FROM user_devices
      WHERE user_id = $1 AND device_id_hash = $2
    `, [student, deviceHash])
    expect(devices.rows).toEqual([{
      platform: 'android',
      app_version: '1.0.1',
      os_version: '15',
      push_token_encrypted: null,
      push_enabled: false,
      last_seen_at: new Date('2026-08-30T00:00:00.000Z'),
    }])
    await expect(repository.disableCurrentDevicePush({
      studentId: student,
      platform: 'ios',
      deviceIdHash: 'missing-device-hash',
      lastSeenAt: new Date('2026-08-30T00:00:00.000Z'),
    })).resolves.toBeNull()
  })

  it('persists the consenting guardian on consent records and rejects cross-user impersonation', async () => {
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const studentA = '00000000-0000-0000-0000-000000000011'
    const studentB = '00000000-0000-0000-0000-000000000012'
    const guardianA = '00000000-0000-0000-0000-000000000021'
    const guardianB = '00000000-0000-0000-0000-000000000022'
    await database.query(`INSERT INTO users (id, role, birth_month, is_minor) VALUES
      ('${studentA}', 'student', '2012-04-01', true),
      ('${studentB}', 'student', '2012-05-01', true),
      ('${guardianA}', 'guardian', NULL, false),
      ('${guardianB}', 'guardian', NULL, false)`)
    await database.query(`INSERT INTO guardian_links (id, student_id, guardian_id, status) VALUES
      ('00000000-0000-0000-0000-000000000031', '${studentA}', '${guardianA}', 'verified'),
      ('00000000-0000-0000-0000-000000000032', '${studentB}', '${guardianB}', 'verified')`)
    const pool = { query: database.query.bind(database), connect: async () => ({ query: database.query.bind(database), release: () => undefined }) } as unknown as Pool
    const app = buildApp({
      repository: new PostgresStudentRepository(pool),
      config: loadConfig({
        NODE_ENV: 'test',
        ALLOW_LEGACY_TEST_HEADERS: 'true',
        CONSENT_VERSION_REQUIRED: 'v1',
        AUTH_PROVIDER: 'email_magic_link',
        AUTH_ISSUER: 'https://issuer.test',
        AUTH_AUDIENCE: 'peraquest-api',
        AUTH_JWKS_URL: 'http://127.0.0.1/jwks',
      }),
      tokenVerifier: {
        verify: async (token, config) => {
          const issuedAt = Math.floor(Date.now() / 1000)
          return { iss: config.issuer, aud: config.audience, sub: token, iat: issuedAt, exp: issuedAt + 300 }
        },
      },
      authUserResolver: {
        resolve: async (_issuer, subject) => {
          if (subject === 'guardian-a-sub') return { id: guardianA, role: 'guardian' }
          if (subject === 'guardian-b-sub') return { id: guardianB, role: 'guardian' }
          return null
        },
      },
    })
    const rejected = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': studentB, 'x-guardian-id': guardianA }, payload: { status: 'granted', version: 'v1' } })
    expect(rejected.statusCode).toBe(403)
    expect(rejected.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })
    const accepted = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': studentA, 'x-guardian-id': guardianA }, payload: { status: 'granted', version: 'v1' } })
    expect(accepted.statusCode).toBe(200)
    const records = await database.query<{ guardian_id: string; student_id: string }>
      ('SELECT guardian_id, student_id FROM consent_records WHERE student_id = $1', [studentA])
    expect(records.rows).toEqual([{ guardian_id: guardianA, student_id: studentA }])
    const rejectedRecords = await database.query('SELECT 1 FROM consent_records WHERE student_id = $1', [studentB])
    expect(rejectedRecords.rows).toEqual([])
    const bearerAccepted = await app.inject({
      method: 'PUT',
      url: `/v1/guardian-links/${studentB}/consents/voice-processing`,
      headers: { authorization: 'Bearer guardian-b-sub' },
      payload: { status: 'granted', version: 'v1' },
    })
    expect(bearerAccepted.statusCode).toBe(200)
    expect(bearerAccepted.json()).toEqual({ type: 'voice_processing', status: 'granted', version: 'v1' })
    const bearerRecords = await database.query<{ guardian_id: string; student_id: string }>
      ('SELECT guardian_id, student_id FROM consent_records WHERE student_id = $1', [studentB])
    expect(bearerRecords.rows).toEqual([{ guardian_id: guardianB, student_id: studentB }])
    await app.close()
  })

  it('records voice consent audit events and queues deletion jobs on withdrawal', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const adult = '00000000-0000-0000-0000-000000000087'
    const minor = '00000000-0000-0000-0000-000000000088'
    const guardian = '00000000-0000-0000-0000-000000000089'
    await database.query(`
      INSERT INTO users (id, role, birth_month, is_minor) VALUES
        ($1, 'student', '2000-01-01', false),
        ($2, 'student', '2012-01-01', true),
        ($3, 'guardian', NULL, false)
    `, [adult, minor, guardian])
    await database.query("INSERT INTO guardian_links (id, student_id, guardian_id, status) VALUES ('00000000-0000-0000-0000-000000000090', $1, $2, 'verified')", [minor, guardian])
    const pool = { query: database.query.bind(database), connect: async () => ({ query: database.query.bind(database), release: () => undefined }) } as unknown as Pool
    const repository = new PostgresStudentRepository(pool)

    await expect(repository.setVoiceConsent(adult, null, 'granted', 'v1')).resolves.toEqual({ status: 'granted', version: 'v1' })
    await expect(repository.setVoiceConsent(adult, null, 'withdrawn', 'v1')).resolves.toEqual({ status: 'withdrawn', version: 'v1' })
    await expect(repository.setVoiceConsent(minor, guardian, 'withdrawn', 'v1')).resolves.toEqual({ status: 'withdrawn', version: 'v1' })

    const audit = await database.query<{ student_id: string; guardian_id: string | null; status: string; version: string; event_type: string }>(`
      SELECT student_id, guardian_id, status, version, event_type
      FROM voice_consent_audit_events
      ORDER BY student_id, status
    `)
    expect(audit.rows).toEqual([
      { student_id: adult, guardian_id: null, status: 'granted', version: 'v1', event_type: 'voice_consent_recorded' },
      { student_id: adult, guardian_id: null, status: 'withdrawn', version: 'v1', event_type: 'voice_consent_recorded' },
      { student_id: minor, guardian_id: guardian, status: 'withdrawn', version: 'v1', event_type: 'voice_consent_recorded' },
    ])
    const jobs = await database.query<{ student_id: string; guardian_id: string | null; reason: string; status: string }>(`
      SELECT student_id, guardian_id, reason, status
      FROM voice_data_deletion_jobs
      ORDER BY student_id
    `)
    expect(jobs.rows).toEqual([
      { student_id: adult, guardian_id: null, reason: 'voice_consent_withdrawn', status: 'pending' },
      { student_id: minor, guardian_id: guardian, reason: 'voice_consent_withdrawn', status: 'pending' },
    ])
  })

  it('enforces one active guardian link for a student', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    await database.query("INSERT INTO users (id, role, birth_month, is_minor) VALUES ('00000000-0000-0000-0000-000000000001', 'student', '2012-04-01', true)")
    await database.query("INSERT INTO guardian_links (id, student_id) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')")
    await expect(database.query("INSERT INTO guardian_links (id, student_id) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001')")).rejects.toThrow()
  })
})
