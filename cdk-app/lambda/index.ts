import { handle } from 'hono/aws-lambda';
import * as path from 'node:path';
import { createApp } from '../../shared/app';

/**
 * Lambda 用エントリポイント。
 *
 * Hono アプリ本体は {@link createApp `../../shared/app`} に置いてあり、
 * ECS 側 (`ecs-app/src/server.ts`) と **同一インスタンス** を使う。
 * ここではランタイム固有の薄いアダプタ層だけを書く。
 *
 * - `PUBLIC_URL` は CDK Stack 側で Function URL から流し込まれる。
 *   これにより HTML 側に URL をハードコードせず、デプロイごとに OGP を切り替えられる。
 * - 静的ファイル(`public/`) は esbuild の `commandHooks.afterBundling` で `/var/task/public` に同梱される。
 */

const app = createApp({
  publicDir: path.join(__dirname, 'public'),
  publicUrl: process.env.PUBLIC_URL ?? '',
  runtime: 'lambda',
});

export const handler = handle(app);
