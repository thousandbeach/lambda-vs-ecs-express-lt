#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StaticAppStack, type StaticAppStackProps } from '../lib/static-app-stack';

/**
 * CDK エントリポイント。 cdk-app/bin/cdk-app.ts と同じ region 解決パターンを踏襲。
 *
 * このスタックは LT 「お前の Lambda それ API サーバーちゃうで」 + 「机上の比較から、実地の検証へ」
 * の **アフター状態** 用。 LT 自身が主張した「静的配信なら S3+CloudFront が正解」 を体現する。
 */

const app = new cdk.App();

const account =
  (app.node.tryGetContext('account') as string | undefined) ??
  process.env.CDK_DEFAULT_ACCOUNT;

// region: Tokyo 固定 (cdk-app / ecs-app と同方針)。CF は global だが、 S3 と
// BucketDeployment 周りは region-specific なので、 リポジトリ統一して Tokyo に揃える。
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

const stackProps: StaticAppStackProps = {
  env: { account, region },
  description:
    'LT slide hosting on S3 + CloudFront. ' +
    'Post-LT archive state — finally matches what both LTs were preaching all along.',
  tags: {
    Project: 'jaws-ug-lt',
    Owner: 'takabo',
    Purpose: 'lt-slide-hosting',
    PreviousStep: 'lambda-cdk-app+ecs-app',
    Runtime: 's3-cloudfront',
  },
};

new StaticAppStack(app, 'LtJawsStaticStack', stackProps);
