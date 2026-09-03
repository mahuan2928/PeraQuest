-- 1 日の出題数を 19 問まで許可します。
-- 英検 3 級はおよそ 120 の知識ポイントがあり、1 ポイントの習得に平均 12 回の作答が必要です。
-- 120 × 12 = 1,440 回。3 か月（週 6 日 = 77 学習日）で終えるには 1 日 19 問が要ります。
-- 12 問のままだと約 4.6 か月かかり、受験日に間に合いません。

ALTER TABLE daily_sessions DROP CONSTRAINT daily_sessions_target_count_check;
ALTER TABLE daily_sessions
  ADD CONSTRAINT daily_sessions_target_count_check
  CHECK (target_count BETWEEN 12 AND 20);

COMMENT ON COLUMN daily_sessions.target_count IS
  'Items in one day. Twelve was the original plan but does not cover Eiken Grade 3 in three months; nineteen does. The upper bound leaves room without allowing an unbounded session.';
