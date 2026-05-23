# syntax=docker/dockerfile:1.7
#
# JAWS-UG LT 続編「机上の比較から、実地の検証へ」用、
# shared/app.ts (Hono) を ECS Express Mode の Fargate タスクとして動かすためのイメージ。
#
# === 設計思想 ===
#  - cdk-app/ (Lambda 版) も内部で esbuild で 1 ファイル化している。
#    ここも同じ戦略で **multi-stage + esbuild bundle** にして
#    「同じ bundle 戦略でホストだけ違う」事実を LT で示す。
#  - build context は **リポジトリルート**。 `shared/` と `ecs-app/runtime/` を
#    同じツリーから COPY するために、Dockerfile のパスは全て repo-root 起点で書く。
#  - 出力イメージは ~85MB (node:20-slim + bundle 1.5MB + 静的ファイル ~6MB)。
#  - runtime stage に node_modules を持ち込まないので攻撃面が小さい。
#
# === ビルド方法 ===
#  CDK 経由(本来の入口):
#    cd ecs-app && npx cdk deploy
#  手動(動作確認用):
#    docker build -f ecs-app/runtime/Dockerfile -t lt-jaws-ecs:dev .
#    docker run --rm -p 8080:8080 -e PUBLIC_URL=http://localhost:8080 lt-jaws-ecs:dev

# ============================================================
# Stage 1: build (esbuild で server.ts を bundle)
# ============================================================
FROM node:20-slim AS build
WORKDIR /build

# package.json と lock を先に COPY → npm ci のキャッシュを効かせる。
# runtime に必要なのは `hono` と `@hono/node-server` だけ。
# (cdk-app と同じく root package.json から hono を借りる構造)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# bundle 対象のソース。
# 構造をリポジトリと **同じ階層** で持ってくると、
# server.ts 内の `import '../../shared/app'` がそのまま解決できる。
COPY shared ./shared
COPY ecs-app/runtime ./ecs-app/runtime

# esbuild で server.ts を bundle。
#  - --platform=node / --target=node20 : Node 20 ターゲット
#  - --format=cjs                       : Node の require 解決を使う(@hono/node-server は CJS/ESM 両対応)
#  - --sourcemap=inline                 : スタックトレース解析のため source map 同梱
#  - --bundle                           : 依存パッケージも全部 1 ファイルに inline する
#  - --minify=false                     : LT で stack trace 見せる可能性があるので minify しない
#  - 依存解決はカレントの node_modules (npm ci で入った hono / @hono/node-server) を参照する
RUN npx --yes esbuild@0.28 ecs-app/runtime/server.ts \
      --bundle \
      --platform=node \
      --target=node20 \
      --format=cjs \
      --sourcemap=inline \
      --outfile=/build/dist/server.js

# ============================================================
# Stage 2: runtime (bundle と静的ファイルだけを持つ最小イメージ)
# ============================================================
FROM node:20-slim AS runtime
WORKDIR /app

# bundle 本体(node_modules は持ち込まない)
COPY --from=build /build/dist/server.js ./server.js

# === 静的ファイル ===
# `shared/app.ts` の readStatic() が public/ 配下を見るので、リポジトリ上の各種素材を
# /app/public 配下に再配置する。Lambda 版 (cdk-app の commandHooks.afterBundling) と
# 同じ配置を意図的にミラーしている。
RUN mkdir -p public/audio public/audio-ecs

# 前回 LT のスライド (HTML / 画像 / 音声)
COPY lt-jaws-audio-prerecorded-final2.html ./public/index.html
COPY icon.jpg ./public/icon.jpg
COPY ogp.jpg ./public/ogp.jpg
COPY audio/ ./public/audio/

# 次回 LT のスライド (B2 で本物が入る前は stub) と音声 (B4 で生成される前は空)
# - `lt-jaws-ecs-migration.html` は repo に常駐させる(無いと COPY が失敗するため)
# - `audio-ecs/` は repo に必ず存在させる(`.gitkeep` を置いてある)
COPY lt-jaws-ecs-migration.html ./public/ecs.html
COPY audio-ecs/ ./public/audio-ecs/

EXPOSE 8080
ENV NODE_ENV=production

# ECS Express が `/health` で HC するので、起動後すぐに応答できる状態にしておく。
# Hono は即座に listen 開始するので追加のスタートアップ待機は不要。
CMD ["node", "server.js"]
