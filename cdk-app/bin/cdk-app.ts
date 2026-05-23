#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkAppStack, type CdkAppStackProps } from '../lib/cdk-app-stack';

const app = new cdk.App();

// === account の解決優先度 ===
//   1. `--context account=...`
//   2. `CDK_DEFAULT_ACCOUNT` (CDK CLI が AWS プロファイルから自動で入れる)
//
// account はマルチプロファイル運用が普通なので、デフォは置かない(明示が必要)。
const account =
  (app.node.tryGetContext('account') as string | undefined) ??
  process.env.CDK_DEFAULT_ACCOUNT;

// === region の解決優先度 ===
//   1. `--context region=...`
//   2. `LT_REGION` 環境変数 (このリポジトリ専用のエスケープハッチ)
//   3. **`'ap-northeast-1'` ハードコード** (このリポジトリの本拠地 = Tokyo, LT 会場の静岡から物理的に近い)
//
// 注: `CDK_DEFAULT_REGION` / `AWS_REGION` / `AWS_DEFAULT_REGION` は **意図的に無視** する。
//
// 理由:
//   `~/.aws/config` の default プロファイルが ap-northeast-1 以外を指していると、
//   CDK CLI が `CDK_DEFAULT_REGION` を別リージョンで埋め、デプロイ先がブレる。
//   このリポジトリは「JAWS-UG 静岡 LT」用、Tokyo 固定がプロジェクト前提。
//   別リージョンへ deploy したい時は **明示的に** `--context region=...` か `LT_REGION` を渡す。
const region =
  (app.node.tryGetContext('region') as string | undefined) ??
  process.env.LT_REGION ??
  'ap-northeast-1';

if (!account) {
  throw new Error(
    'AWS account could not be resolved. ' +
      'Set CDK_DEFAULT_ACCOUNT (cdk deploy does this automatically from your profile), ' +
      'or pass `--context account=123456789012`.',
  );
}

// 既知の本番 Function URL をデフォルトで使う。
// Function URL は CFN 上の循環参照を避けるためここで定数化する(自分の env var に自分の URL を入れられない)。
// 新規アカウントで初回 deploy する人は `--context publicUrl=` を空で渡して 1 回目を deploy、
// 出力された URL を覚えて 2 回目以降は `--context publicUrl=https://...` を指定する。
const DEFAULT_LAMBDA_PUBLIC_URL =
  'https://gxyrfra7u7zs7bz3g6abbkshye0zjynp.lambda-url.ap-northeast-1.on.aws';
const publicUrl =
  (app.node.tryGetContext('publicUrl') as string | undefined) ??
  process.env.LT_PUBLIC_URL ??
  DEFAULT_LAMBDA_PUBLIC_URL;

const stackProps: CdkAppStackProps = {
  env: { account, region },
  publicUrl,
  description:
    'JAWS-UG LT slide hosting on Lambda + Hono. ' +
    'Intentional anti-pattern for next LT comparison.',
  tags: {
    Project: 'jaws-ug-lt',
    Owner: 'takabo',
    Purpose: 'lt-slide-hosting',
    NextStep: 'migrate-to-ecs-express-mode',
    Runtime: 'lambda',
  },
};

new CdkAppStack(app, 'LtJawsLambdaStack', stackProps);