#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsAppStack, type EcsAppStackProps } from '../lib/ecs-app-stack';

/**
 * CDK エントリポイント。
 *
 * cdk-app/bin/cdk-app.ts と意図的に **同じパターン** で書いてある:
 *   - account/region は CLI ctx → env var → デフォルトの順
 *   - publicUrl は CLI ctx → env var → デフォルトの順
 *   - Stack tags は Lambda 版と同じキー(Project / Owner / Purpose) + Runtime のみ差し替え
 *
 * LT の比較軸を「**アプリ層は完全同一・インフラ層だけ差し替え**」に固定するために、
 * 構造をミラーするのが大事。差分は「Runtime タグ」「Stack 名」「公開 URL」だけ。
 */

const app = new cdk.App();

// === account の解決優先度 ===
//   1. `--context account=...` (CLI 明示)
//   2. `CDK_DEFAULT_ACCOUNT` (CDK CLI が AWS プロファイルから自動で入れる)
//
// account はマルチプロファイル運用が普通なので、デフォは置かない(明示が必要)。
const account =
  (app.node.tryGetContext('account') as string | undefined) ??
  process.env.CDK_DEFAULT_ACCOUNT;

// === region の解決優先度 ===
//   1. `--context region=...`
//   2. `LT_REGION` 環境変数 (このリポジトリ専用のエスケープハッチ)
//   3. **`'ap-northeast-1'` ハードコード** (このリポジトリの本拠地 = Tokyo)
//
// 注: `CDK_DEFAULT_REGION` / `AWS_REGION` / `AWS_DEFAULT_REGION` は **意図的に無視** している。
//
// 理由:
//   takabo の AWS プロファイル(`~/.aws/config` の default)が ap-south-1 を指していたため、
//   `CDK_DEFAULT_REGION` 経由で region 解決すると Mumbai に飛んでしまっていた。
//   このリポジトリは「JAWS-UG 静岡 LT」用、 つまり Tokyo にデプロイすることが前提のプロジェクト。
//   別のリージョンへ deploy したい時は **明示的に** `--context region=...` か `LT_REGION` を渡す。
const region =
  (app.node.tryGetContext('region') as string | undefined) ??
  process.env.LT_REGION ??
  'ap-northeast-1';

if (!account) {
  throw new Error(
    'AWS account could not be resolved. ' +
      'Set CDK_DEFAULT_ACCOUNT (cdk deploy populates this automatically from your profile), ' +
      'or pass `--context account=123456789012`.',
  );
}

/**
 * ECS Express Mode が **自動発行する** 公開 URL のデフォルト。
 *
 * 公式ドキュメント: `https://<serviceName>.ecs.<region>.on.aws/` という記述があるが、
 * 実測したところ AWS は `https://<short-prefix>-<32hex>.ecs.<region>.on.aws/` 形式の
 * **ユニーク URL を自動発行する** (例: 当方のデプロイでは
 * `lt-16808a3125334d3f993982859eaf40f6.ecs.ap-northeast-1.on.aws`)。
 *
 * つまり Lambda Function URL と同様、**初回デプロイ後にしか URL が確定しない**:
 *   - 1 回目: 適当な publicUrl で deploy → CfnOutput の `EcsAttrEndpoint` で実 URL を取得
 *   - 2 回目: 取得した URL を `--context publicUrl=https://...` または
 *             この定数 (`DEFAULT_ECS_PUBLIC_URL`) を実 URL に書き換えて再 deploy
 *             (PUBLIC_URL 環境変数 → OGP / Twitter Card に絶対 URL を埋めるため)
 *
 * 当 LT リポでは現状の値 (1 回目で出た実 URL) をハードコードしておく。
 * `cdk destroy` → 再 deploy したら URL が変わる可能性があるので、
 * その時はここを書き換えるか `--context publicUrl=...` で渡す。
 */
const DEFAULT_ECS_PUBLIC_URL =
  'https://lt-16808a3125334d3f993982859eaf40f6.ecs.ap-northeast-1.on.aws';

const publicUrl =
  (app.node.tryGetContext('publicUrl') as string | undefined) ??
  process.env.LT_PUBLIC_URL ??
  DEFAULT_ECS_PUBLIC_URL;

const stackProps: EcsAppStackProps = {
  env: { account, region },
  publicUrl,
  description:
    'JAWS-UG LT slide hosting on ECS Express Mode (Fargate + auto-managed ALB). ' +
    'Implements the "ちゃんとした" pattern that the previous LT recommended.',
  tags: {
    Project: 'jaws-ug-lt',
    Owner: 'takabo',
    Purpose: 'lt-slide-hosting',
    // 参考: 前段の Lambda 版は `cdk-app/` 配下。AWS タグ値は `( ) ` が不可なので
    // URL 風にはせず短い識別子で済ます(`+` `-` `.` `_` `:` `/` `@` は OK)。
    PreviousStep: 'lambda-cdk-app',
    Runtime: 'ecs-express',
  },
};

new EcsAppStack(app, 'LtJawsEcsExpressStack', stackProps);
