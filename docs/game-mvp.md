# PeraQuest Game MVP

PeraQuest のゲーム部分は、学習とは別のミニゲームではなく、学習成果が冒険の進捗に変わる軽量 RPG 体験として扱います。

## Product Direction

- 生徒は英語学習を進めることで XP、コイン、バッジ、Quest 進捗を獲得します。
- 報酬はサーバーが検証した学習イベントまたは保護者連携イベントからのみ発生します。
- フロントエンドは報酬を計算せず、`GET /api/v1/me/game-state` と stage-attempt の結果だけを表示します。
- 抽選、ランキング、課金アイテム、消費を促す文言は P0 では扱いません。

## P0 Rules

| Event | XP | Coins | Quest | Badge |
| --- | ---: | ---: | --- | --- |
| Guardian verification | 20 | 0 | No step change | `guardian_shield` |
| Stage attempt passed | 100 | 50 | Unlock chapter 1 and advance 1 step | `level_check_cleared` |
| Stage attempt completed but not passed | 40 | 20 | No step change | `level_check_challenger` |

## Data Model

- `student_game_state` stores the current projection:
  - `total_xp`
  - `activity_coins`
  - `quest_chapter`
  - `quest_step`
- `game_reward_ledger` is append-only by event source:
  - `source_type`
  - `source_ref`
  - `reason`
  - XP/coin/quest deltas
  - badge codes
- `UNIQUE (student_id, source_type, source_ref)` prevents duplicate reward grants.

## API

- `GET /api/v1/me/game-state`
  - Student Bearer only.
  - Legacy test headers are rejected.
  - Returns the current Quest progress, XP, activity coins, and badges.
- `POST /api/v1/stage-attempts/{stageAttemptId}/submit`
  - Returns the server-scored result.
  - Includes optional `rewards` when the submitted attempt grants a reward.
  - Idempotency replay returns the saved response snapshot and does not grant duplicate rewards.

## UI

- Student demo displays a Quest panel with XP, coins, chapter, progress steps, and badges.
- After level check submission, the result card displays only the awarded XP/coins/Quest step.
- UI does not show tokens, endpoints, HTTP status, JSON, or internal implementation wording.
