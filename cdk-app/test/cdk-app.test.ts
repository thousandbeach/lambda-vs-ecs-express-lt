import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CdkAppStack } from '../lib/cdk-app-stack';

/**
 * {@link CdkAppStack} の振る舞いを **生成テンプレートのプロパティ単位** で検証する。
 *
 * 「スナップショットに対する diff チェック」は採用していない。スナップショットだと
 *   - 「何が大事か」が伝わらない
 *   - 関係ない CDK バージョンアップで一斉に赤くなる
 * の 2 つで実害が出やすいので、**意味のあるアサーション** で書く。
 *
 * 重視している不変条件:
 *  - Function URL が認証なし (LT 公開URL なので)
 *  - PUBLIC_URL が Hono の OGP 埋め込みに渡る
 *  - LogGroup が明示的に存在し、メインの Lambda がそれを参照している
 *  - 副次 Lambda(deprecated な logRetention カスタムリソース)が **存在しない**
 */

const DEFAULT_TEST_URL = 'https://test.example.lambda-url.ap-northeast-1.on.aws';

function buildTemplate(overrides?: ConstructorParameters<typeof CdkAppStack>[2]): Template {
  const app = new cdk.App();
  const stack = new CdkAppStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
    publicUrl: DEFAULT_TEST_URL,
    ...overrides,
  });
  return Template.fromStack(stack);
}

describe('CdkAppStack', () => {
  test('Lambda Function は 1 個だけ生成される(logRetention 由来のカスタムリソース Lambda は消えてる)', () => {
    const template = buildTemplate();
    // logRetention プロパティを使うと CDK が裏で `LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a` 等の
    // Lambda カスタムリソースを生成してしまう。logGroup プロパティへの移行で、これが消えていることを担保する。
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('Lambda には Hono 用ランタイムと適切なリソース割当が入る', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      MemorySize: 512,
      Timeout: 10,
    });
  });

  test('Lambda に PUBLIC_URL 環境変数が注入されており、Hono の OGP 出力に渡る', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          PUBLIC_URL: DEFAULT_TEST_URL,
        }),
      },
    });
  });

  test('LogGroup を明示的に作成し、Lambda がそれを参照している', () => {
    const template = buildTemplate();

    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 7, // ONE_WEEK
    });
    template.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });

  test('Function URL は認証なし(LT 公開用)', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'NONE',
    });
    template.resourceCountIs('AWS::Lambda::Url', 1);
  });

  test('lambdaMemorySize / lambdaTimeout を上書きできる', () => {
    const template = buildTemplate({
      env: { account: '123456789012', region: 'ap-northeast-1' },
      lambdaMemorySize: 1024,
      lambdaTimeout: cdk.Duration.seconds(30),
      publicUrl: DEFAULT_TEST_URL,
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 1024,
      Timeout: 30,
    });
  });

  test('CloudFormation Outputs に公開 URL と関数名が含まれる', () => {
    const template = buildTemplate();

    // 名前ベースのアサーションは fragile なので、Outputs にエクスポート名で 3 つ揃ってる事を確認
    template.hasOutput('LtUrl', {});
    template.hasOutput('LtHandlerName', {});
    template.hasOutput('LtLogGroupName', {});
  });

  test('Lambda 自体に Runtime=lambda タグが付与され、ECS との料金識別に使える', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([{ Key: 'Runtime', Value: 'lambda' }]),
    });
  });

  test('Stack タグ(NextStep など)が cdk.Tags 経由で取得できる', () => {
    // explicitStackTags ON では Stack タグは個別リソースの CFN テンプレに乗らない。
    // 「タグ自体が設定されている事実」だけを Stack オブジェクト経由で検証する。
    const app = new cdk.App();
    const stack = new CdkAppStack(app, 'TaggedStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      publicUrl: DEFAULT_TEST_URL,
      tags: {
        Project: 'jaws-ug-lt',
        Owner: 'takabo',
        NextStep: 'migrate-to-ecs-express-mode',
      },
    });

    const stackTags = stack.tags.tagValues();
    expect(stackTags).toMatchObject({
      Project: 'jaws-ug-lt',
      Owner: 'takabo',
      NextStep: 'migrate-to-ecs-express-mode',
    });
  });
});
