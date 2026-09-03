-- 0024: レベルチェックの再受験ゲート（PRD 2.4.2）。
--
-- いまは提出直後にもう一度受けられます。報酬は 1 回きりにしましたが、同じスナップショットを
-- 続けて解けること自体が問題で、点は上がるのに読み取れる力は増えません。
--
-- 「クールダウン **または** 補強課題」なので、待たされるだけにはしません。
-- 毎日の関卡を 3 回終えれば、7 日待たずに受け直せます。復習して受け直すほうが速い、
-- という順序にすることが目的で、待ち時間そのものが目的ではありません。
--
-- 出題バリアント（2.4.3）はここでは扱いません。題庫（A-1）が育つまで
-- サンプリングする母集団がないので、作っても選びようがありません。
-- 判定そのものは純粋な関数にします。stage_attempts は提出時刻の後付けをトリガで禁じているので
-- （それ自体は正しい）、表に行を置く方法では「7 日後」を試せません。
-- 日数の計算と、表を読む部分を分けておけば、どちらも本物のまま検証できます。
CREATE OR REPLACE FUNCTION calculate_stage_retake_gate(
  p_last_submitted_at timestamptz,
  p_sessions_since integer
)
RETURNS TABLE (allowed boolean, days_remaining integer, sessions_remaining integer)
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    p_last_submitted_at IS NULL OR p_sessions_since >= 3 OR days.value = 0,
    days.value,
    greatest(0, 3 - COALESCE(p_sessions_since, 0))
  FROM (
    SELECT CASE
      WHEN p_last_submitted_at IS NULL THEN 0
      ELSE greatest(0, 7 - floor(extract(epoch FROM (CURRENT_TIMESTAMP - p_last_submitted_at)) / 86400)::int)
    END AS value
  ) AS days;
$$;

CREATE OR REPLACE FUNCTION stage_retake_gate(p_student_id uuid, p_exam_id uuid)
RETURNS TABLE (allowed boolean, days_remaining integer, sessions_remaining integer)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_last_submitted timestamptz;
  v_sessions integer;
BEGIN
  SELECT max(a.submitted_at) INTO v_last_submitted
  FROM stage_attempts a
  JOIN stage_exam_versions ev ON ev.id = a.exam_version_id
  WHERE a.student_id = p_student_id AND ev.exam_id = p_exam_id AND a.submitted_at IS NOT NULL;

  -- 受け直す前にやり直したぶんだけを数えます。受験前の復習では開きません。
  SELECT count(*)::int INTO v_sessions
  FROM daily_sessions
  WHERE student_id = p_student_id AND status = 'completed'
    AND (v_last_submitted IS NULL OR updated_at > v_last_submitted);

  RETURN QUERY SELECT * FROM calculate_stage_retake_gate(v_last_submitted, v_sessions);
END;
$$;

COMMENT ON FUNCTION calculate_stage_retake_gate(timestamptz, integer) IS
  'PRD 2.4.2: a retake needs a cooldown or remedial work. Three completed daily sessions open it sooner than seven days, so revising is the faster route rather than waiting being the point.';
