# 公開デモのデプロイ

構成は 2 つだけです。

```
web  : Cloudflare Workers（静的配信、既存）  https://peraquest-dev.larkjapandemo.workers.dev
API  : Fly.io（nrt / 東京）— アプリと Postgres の両方
```

**必要なアカウントは Fly.io の 1 つだけです。** Postgres も Fly 側で作れるので、
別の DB サービスは要りません。イメージは Fly 側でビルドされるため、
手元に Docker も要りません。

Fastify は Workers では動かず、Cloudflare に Postgres はありません。
スキーマは plpgsql の関数とトリガに不変条件を預けているので、D1（SQLite）へは移せません
——移すと不変条件が全部アプリ側に散ります。それがこの構成の理由です。

処理地はどちらも日本国内にします。学習者は未成年で、審査でも訊かれる箇所です。

---

## 1. アカウント（人間しかできない作業）

Fly.io の登録だけです。https://fly.io/app/sign-up
（クレジットカードの登録を求められます。この構成の想定は無料枠〜数ドル/月です。）

## 2. ログイン

flyctl は導入済みです。ブラウザが開くので、そこで許可してください。

```bash
fly auth login
```

## 3. アプリと Postgres

```bash
fly launch --no-deploy --copy-config --name peraquest-api --region nrt

# Postgres も Fly 側に作ります。別サービスは要りません。
fly postgres create --name peraquest-db --region nrt --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
fly postgres attach peraquest-db --app peraquest-api   # DATABASE_URL が自動で入ります

fly secrets set \
  DEMO_SESSION_SECRET="$(openssl rand -hex 32)" \
  CORS_ORIGIN='https://peraquest-dev.larkjapandemo.workers.dev' \
  AUTH_ISSUER='https://issuer.example.test' \
  AUTH_AUDIENCE='peraquest-api' \
  AUTH_JWKS_URL='https://issuer.example.test/.well-known/jwks.json'
```

`fly postgres attach` が `DATABASE_URL` を設定するので、手で貼る必要はありません。

`NODE_ENV` / `DEMO_DEPLOYMENT` / `DEMO_API_ENABLED` は `fly.toml` に入っています。

> **`DEMO_DEPLOYMENT` について。** 本番でデモの入口を開けるのはこのフラグだけです。
> 本番の締めつけ——auth URL の HTTPS 必須、テスト用ヘッダの禁止——はそのまま残ります。
> 宣言しなければ入口は閉じたままなので、これは穴ではなく「デモ環境という宣言」です。

> **認証は未実装です。** `AUTH_*` は形式を満たすためのプレースホルダで、
> 本物の学習者ログインはまだありません。デモはデモトークンだけで動きます。
> 一般公開する前に、ここは本物にする必要があります。

## 4. デプロイ

```bash
fly deploy --remote-only   # イメージは Fly 側でビルドされます（手元に Docker は不要）
fly scale count 1          # 1 台に固定（理由は下の「既知の制約」）
```

`release_command` が毎回この順で走ります（`apps/api/src/release.ts`）。

```
migrate → デモ 14 題を投入 → content/items を検証して in_review で投入
        → 8 題以上ある知識ポイントを公開 → 充足を出力
```

題庫ファイルが壊れていればリリースは止まります。起動してから気づくより安全です。
公開時の reviewer は `unreviewed-demo-seed` です。教研レビューを受けていない題に
本物の人名を書くことはしません。

## 5. web を API に向ける

```bash
VITE_API_BASE_URL=https://peraquest-api.fly.dev npm run deploy
```

未設定だとビルドが止まります（`scripts/check-api-base-url.mjs`）。
以前これが空だったせいで、API 呼び出しが同一オリジンに飛び、
SPA のフォールバックが `index.html` を 200 で返し、今日の学習が空白になっていました。

## 6. 動いていることの確認

`/health` では足りません。**静的サイトも 200 を返す**ので、確認になりません。
API 自身のオリジンに対して、デモの入口と今日の学習まで通します。

```bash
API=https://peraquest-api.fly.dev

TOKEN=$(curl -sS -X POST "$API/v1/demo/session" \
  -H 'content-type: application/json' -d '{"scenario":"minor_guardian_voice"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["studentToken"])')

curl -sS "$API/api/v1/me/daily-plan" -H "authorization: Bearer $TOKEN"
curl -sS -X POST "$API/api/v1/me/daily-sessions" -H "authorization: Bearer $TOKEN"
```

最後のレスポンスに `items` が 12 件以上あれば、今日の学習は表示されます。

---

## 既知の制約

| | 内容 |
|---|---|
| **インスタンスは 1 台** | デモのトークン台帳がプロセス内の `Map` です。複数台にすると「発行した台以外では無効」になり、トークン不具合に見える形で落ちます。台帳を外に出すまで増やせません。 |
| **デモセッションが `users` 行を作る** | 認証なしで 1 回叩くごとに 1 行増えます。TTL は 10 分ですが、行を消す仕組みがありません。公開前に上限か掃除が要ります。 |
| **認証が未実装** | 上記のとおり。 |
| **題庫は 1 知識ポイントだけ** | `vocabulary.context` の 12 題のみ。範囲は `docs/knowledge-point-scope.md`。 |
