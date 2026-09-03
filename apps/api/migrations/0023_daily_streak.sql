-- 0023: 連続学習日数。
--
-- 保存しません。連続日数は now() の関数で、途切れるのは「何かが起きたから」ではなく
-- 「何も起きないまま日付が変わったから」です。列に持つとその瞬間に誰も動いておらず、
-- 次に学習したときにしか直りません。B-2 の鮮度と同じ理由で、読むたびに数えます。
--
-- freeze（1 回ぶんの見逃し）は暦の週ではなく「前回 freeze から 7 日」で数えます。
-- ISO 週で区切ると、日曜と月曜を続けて休んだ人は別々の週の freeze を 2 つ使えて
-- 2 日の穴が埋まるのに、同じ週の火曜と木曜を休んだ人は途切れます。
-- 保護者に説明できない差なので、暦ではなく間隔で持ちます。
CREATE OR REPLACE FUNCTION daily_streak(p_student_id uuid)
RETURNS TABLE (current_days integer, freeze_available boolean, last_study_date date)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date;
  v_cursor date;
  v_days integer := 0;
  v_freeze_last date;
  v_freeze_recent date;
  v_studied boolean;
  v_guard integer := 0;
BEGIN
  SELECT max(session_date) INTO last_study_date
  FROM daily_sessions WHERE student_id = p_student_id AND status = 'completed';

  IF last_study_date IS NULL THEN
    RETURN QUERY SELECT 0, true, NULL::date;
    RETURN;
  END IF;

  -- 今日はまだ終わっていないので、今日やっていなくても途切れとは数えません。
  v_cursor := v_today;
  IF NOT EXISTS (
    SELECT 1 FROM daily_sessions
    WHERE student_id = p_student_id AND session_date = v_today AND status = 'completed'
  ) THEN
    v_cursor := v_today - 1;
  END IF;

  -- 必ず今日から過去へ歩きます。逆向きに歩くと答えが変わります。
  -- 直近の欠けに freeze を使うかどうかは選べません（過去に遡って節約できない）ので、
  -- 「新しいほうから順に、使えるなら使う」だけが正しい畳み方です。
  LOOP
    v_guard := v_guard + 1;
    EXIT WHEN v_guard > 400;

    SELECT EXISTS (
      SELECT 1 FROM daily_sessions
      WHERE student_id = p_student_id AND session_date = v_cursor AND status = 'completed'
    ) INTO v_studied;

    IF v_studied THEN
      v_days := v_days + 1;
      v_cursor := v_cursor - 1;
    ELSIF v_freeze_last IS NULL OR (v_freeze_last - v_cursor) >= 7 THEN
      v_freeze_last := v_cursor;
      IF v_freeze_recent IS NULL THEN
        v_freeze_recent := v_cursor;
      END IF;
      v_cursor := v_cursor - 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    v_days,
    v_freeze_recent IS NULL OR (v_today - v_freeze_recent) >= 7,
    last_study_date;
END;
$$;

COMMENT ON FUNCTION daily_streak(uuid) IS
  'Read-time only, and walked backwards from today on purpose. A streak ends because time passed, not because anything happened, so nothing is running on the day it would need to be written down.';
