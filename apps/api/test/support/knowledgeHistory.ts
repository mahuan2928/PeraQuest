// 習熟度の投影は台帳からしか作れません（0020 のトリガ）。
// テストで履歴を用意するための最小の道具です。時刻を指定できるので、
// 窓・段位・次回予定の検証に使えます。

export interface HistoryDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ rows: Row[] }>
}

export interface RecordedAnswer {
  correct: boolean
  /** ISO 8601。作答時刻をずらして間隔の検証に使います。 */
  at: string
  timedOut?: boolean
}

const LEDGER = {
  dataset_version: 'cefr-j-vocabulary-profile-v1.5',
  content_version: 'test',
  source_name: 'Open Language Profiles: CEFR-J Vocabulary Profile',
  source_url: 'https://github.com/openlanguageprofiles/olp-en-cefrj',
  license_name: 'CEFR-J Vocabulary Profile v1.5 licence',
  license_scope: 'commercial app use with attribution',
  attribution_text: 'CEFR-J Vocabulary Profile v1.5 (Tono, Y.)',
  attribution_location: '/credits',
  author: 'test',
  reviewer: 'test',
  evidence_link: 'https://example.invalid/licence',
}

/** 指定した知識ポイントに、指定した時刻の作答履歴を積みます。 */
export async function recordAnswers(
  database: HistoryDatabase,
  studentId: string,
  knowledgePointRef: string,
  answers: RecordedAnswer[],
): Promise<void> {
  for (const [index, answer] of answers.entries()) {
    const day = new Date(answer.at).toISOString().slice(0, 10)
    const session = await database.query<{ id: string }>(
      `INSERT INTO daily_sessions (student_id, session_date, target_count)
       VALUES ($1, $2::date, 12)
       ON CONFLICT (student_id, session_date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [studentId, day],
    )
    const item = await database.query<{ id: string }>(
      `INSERT INTO content_items
         (item_kind, knowledge_point_ref, skill_ref, payload, status,
          dataset_version, content_version, source_name, source_url, license_name, license_scope,
          commercial_allowed, attribution_text, attribution_location, author, reviewer, reviewed_at, evidence_link)
       VALUES ('mcq', $1, 'grammar', '{}'::jsonb, 'published',
               $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, now(), $12)
       RETURNING id`,
      [
        knowledgePointRef, LEDGER.dataset_version, `${LEDGER.content_version}-${knowledgePointRef}-${index}`,
        LEDGER.source_name, LEDGER.source_url, LEDGER.license_name, LEDGER.license_scope,
        LEDGER.attribution_text, LEDGER.attribution_location, LEDGER.author, LEDGER.reviewer, LEDGER.evidence_link,
      ],
    )
    await database.query(
      `INSERT INTO daily_answers
         (session_id, student_id, content_item_id, knowledge_point_ref, outcome, timed_out,
          earned_score, max_score, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8::timestamptz)`,
      [
        session.rows[0]!.id, studentId, item.rows[0]!.id, knowledgePointRef,
        answer.timedOut ? 'skipped' : answer.correct ? 'correct' : 'incorrect',
        answer.timedOut === true, answer.correct && !answer.timedOut ? 1 : 0, answer.at,
      ],
    )
    await database.query('SELECT apply_daily_session_mastery_due($1, $2)', [session.rows[0]!.id, studentId])
  }
}
