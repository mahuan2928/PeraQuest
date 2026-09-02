# PeraQuest Online Demo Runbook

This runbook is for a 3-5 minute product demo of the online PeraQuest experience.

## Demo URL

- Primary URL: `https://peraquest-dev.larkjapandemo.workers.dev`
- Versioned URL example: `https://peraquest-dev.larkjapandemo.workers.dev/?verify=d780fe2a&cachebust=demo`
- API backend: Render development API.

Use a versioned URL with a fresh `cachebust` value when verifying a new Cloudflare deployment.

## Demo Story

PeraQuest turns learning outcomes into adventure progress:

- The student starts an English quest.
- The guardian unlocks safe learning access.
- The student completes a level check.
- The level check creates review focus items.
- The student completes a guided review quest.
- XP, coins, badges, and Quest Map progress update.
- The guardian can see a parent-friendly summary of the child's progress.

## 3-5 Minute Script

### 1. Open the student demo

Action:

- Open the demo URL.
- Click `デモを体験する`.

Expected:

- Student page shows `今日の学習を始めます`.
- `Demo Guide` appears and tells the presenter the recommended next action.
- `Quest Map` appears.
- `冒険バッグ` appears.
- Initial Quest Map shows:
  - `Chapter 1 / はじまりの島`
  - `Chapter 2 / 復習の森`
  - `Chapter 3 / リスニング入り江`

Talk track:

- "The learner sees a game-like path, but every step is tied to a learning or safety event."
- "Nothing exposes tokens, endpoints, HTTP statuses, JSON, or internal debug details."

### 2. Create guardian invitation

Action:

- In the student page, click `招待コードを発行します`.

Expected:

- The app switches to the guardian experience.
- Guardian page shows `お子さまの学習を見守ります`.
- `連携を確認します` is enabled.

Talk track:

- "The student cannot unlock the formal learning flow until the guardian relationship is verified."
- "The demo shows the safety gate without exposing implementation details."

### 3. Verify guardian link

Action:

- Click `連携を確認します`.
- Wait for `お子さまとの連携が完了しました`.
- Switch back with `生徒として体験`.

Expected:

- Student safety checklist marks guardian verification as complete.
- Quest progress moves forward.
- `レベルチェックを開始します` becomes available.

Talk track:

- "Guardian verification becomes a meaningful in-game milestone, not a separate admin step."

### 4. Complete the level check

Action:

- Click `レベルチェックを開始します`.
- Click `デモ用の回答を入れます`.
- Click `答えを提出します`.

Expected:

- Result card shows `合格ラインに到達しました`.
- Reward celebration shows XP, coins, and `レベルチェッククリア`.
- Quest Map moves to `復習の森`.
- `冒険バッグ` shows updated XP, coins, route map progress, and badges.
- `今日の冒険まとめ` appears.

Talk track:

- "The assessment is not just a score. It drives mastery, rewards, review routing, and the next adventure step."

### 5. Complete the guided review quest

Action:

- Click `復習クエストを始めます`.
- Confirm the panel shows:
  - `例文を声に出して読みました`
  - `今日いちばん復習したいポイント`
  - `短い英文を1つ書き直しました`
- Verify the completion button is disabled at `0 / 3 タスク完了`.
- Check the read-aloud task.
- Select one review focus item.
- Enter a short sentence, for example `I finished my homework.`
- Verify `3 / 3 タスク完了`.
- Click `今日の復習を完了します`.

Expected:

- Reward celebration shows `+15 XP`, `+5 コイン`, and `復習の森クリア`.
- Quest Map moves to `4 / 5 スポット達成`.
- `次の島をプレビューします` becomes available.
- `冒険バッグ` includes `復習の森クリア`.

Talk track:

- "The review quest is no longer a one-click reward. It now requires three small learning actions."
- "This makes the demo feel closer to a real learning product while staying lightweight."

### 6. Preview the next island

Action:

- Click `次の島をプレビューします`.
- Click `1問だけ体験します`.
- Choose `図書館で会う`.
- Click `答えを確認します`.

Expected:

- Feedback shows `正解です。library は「図書館」です。`
- Reward celebration shows `+10 XP`, `+3 コイン`, and `リスニング入り江体験`.
- `冒険バッグ` includes `リスニング入り江体験`.
- `今日の冒険まとめ` includes:
  - `復習の森をクリアしました`
  - `リスニング入り江を体験しました`

Talk track:

- "The next island is a preview of how the map can expand into more skill areas."

### 7. Show the guardian report

Action:

- Switch to `保護者として体験`.

Expected:

- Guardian report shows `お子さまの冒険まとめ`.
- Guardian report shows `家庭サポートメモ`.
- It includes latest student-side journey progress, XP, coins, badges, and next recommendation.
- It includes a parent-friendly encouragement cue under `声かけ例`.

Talk track:

- "The parent sees progress in product language: what the child did, what they earned, and what to do next."

## Demo Checks

Before an external demo:

- Open the versioned Cloudflare URL with a fresh `cachebust`.
- Confirm the loaded script asset is not stale if the page looks old.
- Start a new demo session with `もう一度開始します` if a previous session is still visible.
- Confirm the first screen contains `Quest Map`, `冒険バッグ`, and `Chapter 1`.
- Confirm the student page contains `Demo Guide`.
- Confirm the level check contains `デモ用の回答を入れます`.
- Confirm the guardian report contains `家庭サポートメモ`.
- Confirm the Render API is awake by reaching the student page after `デモを体験する`.

## Fallbacks

If the page shows an older UI:

- Add or change the query parameter, for example `?verify=<version>&cachebust=<timestamp>`.
- Hard refresh the browser.
- Confirm the HTML references the latest built asset.

If the API is slow:

- Pause at the welcome screen and explain that the demo backend is waking up.
- Retry `デモを体験する` after a short wait.
- Use `もう一度開始します` to start a clean session if state looks inconsistent.

If the level check reward numbers differ:

- Treat this as acceptable when the backend reward policy differs between pass/fail or existing state.
- The important demo assertions are that XP, coins, badges, Quest Map, bag, summary, and guardian report all update consistently.

## What Not To Demo Yet

- Do not present payment as ready.
- Do not show tokens, endpoints, JSON payloads, or HTTP status codes.
- Do not position the review and listening rewards as persisted production rules until backend persistence is added for those demo-only interactions.
- Do not promise ranking, gacha, paid items, or competitive mechanics.
