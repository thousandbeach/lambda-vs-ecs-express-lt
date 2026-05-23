/**
 * ECS Express Mode 用エントリポイント。
 *
 * Hono アプリ本体は {@link createApp `../../shared/app`} に置いてあり、
 * Lambda 側 (`cdk-app/lambda/index.ts`) と **同一インスタンス** を使う。
 * ここではランタイム固有の薄いアダプタ層 (Node.js プロセス + `@hono/node-server`) だけを書く。
 *
 * - 静的ファイル(`public/`) は Dockerfile の `COPY` で `/app/public` に同梱される。
 * - `PUBLIC_URL` は CDK Stack 側で `CfnExpressGatewayService.primaryContainer.environment` から流し込まれる。
 *   これにより HTML 側に URL をハードコードせず、デプロイごとに OGP / Twitter Card を切り替えられる。
 * - 終了シグナル(`SIGTERM`/`SIGINT`)を捕まえて速やかに exit する。
 *   ECS タスク停止時の grace period 内に終わらないと SIGKILL されるため、明示的にハンドルする。
 */
import { serve } from '@hono/node-server';
import * as path from 'node:path';
import { createApp } from '../../shared/app';

const port = Number(process.env.PORT ?? 8080);
const publicUrl = process.env.PUBLIC_URL ?? '';

// Dockerfile の runtime stage では `/app/server.js` + `/app/public/*` の構成。
// esbuild バンドル後の __dirname は `/app` なので、その直下に `public/` がある形に揃える。
// (`../public` はバンドル前の `ecs-app/runtime/server.ts` から見たレイアウトであって、
//  バンドル後の実行時には正しくない)
const app = createApp({
  publicDir: path.join(__dirname, 'public'),
  publicUrl,
  runtime: 'ecs-express',
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(
    `[lt-jaws-ecs] listening on :${info.port} (PUBLIC_URL=${publicUrl || '(empty)'})`,
  );
});

// グレースフルシャットダウン。ECS は SIGTERM → grace 30s → SIGKILL を投げてくる。
// `@hono/node-server` の `serve()` が返す Node の `http.Server` を `close()` で落とす。
const shutdown = (signal: NodeJS.Signals): void => {
  // eslint-disable-next-line no-console
  console.log(`[lt-jaws-ecs] caught ${signal}, shutting down`);
  server.close((err?: Error) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error(`[lt-jaws-ecs] error during shutdown:`, err);
      process.exit(1);
    }
    process.exit(0);
  });
  // どうしても閉じない接続があった場合の最終手段
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.warn(`[lt-jaws-ecs] force exit after 25s`);
    process.exit(0);
  }, 25_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
