# API 用。web は Cloudflare Workers に静的配信されるので、ここには入りません。
FROM node:22-slim AS build
WORKDIR /app

# ワークスペースの依存解決に必要な manifest だけ先に入れて、
# ソース変更のたびに npm ci をやり直さないようにします。
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY apps/desktop/package.json apps/desktop/
COPY packages/contracts/package.json packages/contracts/
COPY packages/platform/package.json packages/platform/
RUN npm ci

COPY tsconfig*.json ./
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @peraquest/contracts --if-present \
 && npm run build -w @peraquest/platform --if-present \
 && npm run build -w @peraquest/api

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/platform/package.json packages/platform/
RUN npm ci --omit=dev --workspace @peraquest/api --include-workspace-root

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages packages
# マイグレーションと題庫は実行時に読みます。リリース手順が参照するので同梱します。
COPY apps/api/migrations apps/api/migrations
COPY content content

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
