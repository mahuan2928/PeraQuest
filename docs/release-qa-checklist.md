# PeraQuest Demo Release QA Checklist

Use this checklist before sharing the online demo externally.

## Release Target

- Demo URL: `https://peraquest-dev.larkjapandemo.workers.dev`
- API backend: Render development API
- Frontend deploy target: Cloudflare Workers Static Assets
- Demo scope: student adventure, guardian verification, level check, review quest, listening preview, guardian report
- Not in scope: payment, production subscription purchase, rankings, gacha, persisted review/listening rewards

## Local Quality Gates

Run these before deploying frontend changes:

```bash
npm run lint
npm run typecheck
npm run test -w @peraquest/web
npm run build
```

If full workspace tests hit the known local API parallel hook timeout, rerun the API suite serially:

```bash
CI= npm run test -w @peraquest/api -- --no-file-parallelism --maxWorkers=1 --maxConcurrency=1
```

## Deployment Check

- Build and deploy with the Render API endpoint:

```bash
VITE_API_BASE_URL=https://peraquest-api-dev.onrender.com npm run build:cloudflare && npx --yes wrangler@4.124.0 deploy --keep-vars
```

- Confirm Wrangler prints `Uploaded peraquest-dev`.
- Record the Cloudflare `Current Version ID` in the handoff.
- Open a fresh URL with a query parameter, for example `?verify=v22`.

## Online Smoke Test

- Welcome page shows `英検3級・学習冒険デモ`.
- Welcome page shows `学習成果が、冒険の進みになる。`.
- Welcome page shows `続けたくなる学習`, `見守れるレポート`, and `親子で始める英検準備`.
- `デモを体験する` opens the product demo without exposing tokens, endpoints, HTTP status, or JSON.
- Student page shows `Demo Guide`, `Quest Map`, and `冒険バッグ`.
- `招待コードを発行します` switches to the guardian experience with a prefilled code.
- `連携を確認します` completes guardian verification.
- Student page unlocks `レベルチェックを開始します`.
- Level check shows `デモ用の回答を入れます`.
- After using the demo answer button, `答えを提出します` is enabled.
- Submitting shows reward feedback, updated Quest Map progress, and `今日の冒険まとめ`.
- Review quest requires three tasks before `今日の復習を完了します` is enabled.
- Next island preview opens after the review quest.
- Listening cove one-question demo awards `リスニング入り江体験`.
- Guardian report shows `お子さまの冒険まとめ` and `家庭サポートメモ`.

## Mobile Width Check

- Open browser devtools or resize below `680px`.
- Welcome value cards stack in one column.
- `Demo Guide` stacks in one column.
- `デモ用の回答を入れます` remains visible and tappable.
- Quest Map node buttons remain readable.
- Guardian report stat cards fit in two columns.

## Reset And Recovery

- Use `最初からやり直します` to reset a stale session.
- If the API is waking up, the welcome page should show the slow-start hint.
- If a request fails, the UI should show user-friendly retry copy, not raw technical details.
- If the page looks stale, change the query parameter and hard refresh.

## Demo Talk Track Checks

- Student value: learning outcomes become adventure progress.
- Guardian value: parents see progress, next recommendation, and a concrete encouragement cue.
- Product safety: guardian verification gates the formal learning flow.
- Product stability: the demo answer button keeps the level check result explainable.
- Scope control: payment is intentionally not presented as ready.
