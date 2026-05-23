import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EcsAppStack } from '../lib/ecs-app-stack';

/**
 * {@link EcsAppStack} の振る舞いを **生成テンプレートのプロパティ単位** で検証する。
 *
 * 設計方針は cdk-app/test/cdk-app.test.ts と一致させてある:
 *  - スナップショット diff は採用しない(関係ない CDK バージョンアップで赤くなるので)
 *  - 「**LT の主張に直結する不変条件**」だけを意味のあるアサーションで書く
 *
 * 重視している不変条件:
 *  - ECS Express Service が 1 個だけ生成される(Fargate Service と混同しないこと)
 *  - cpu/memory/containerPort/healthCheckPath が LT 構成 (256/512/8080/`/health`) と一致
 *  - serviceName が決定論的(`lt-jaws-ecs`)
 *  - PUBLIC_URL が container env に注入されている
 *  - LogGroup が明示作成され、Service の awsLogsConfiguration が参照している
 *  - 2 つの IAM Role の trust principal と managed policy が ECS Express 仕様通り
 *  - VPC は 2 AZ public-only, NAT GW 0
 *  - Service / LogGroup 両方に `Runtime=ecs-express` タグ
 */

const DEFAULT_TEST_URL = 'https://test-lt-jaws-ecs.ecs.ap-northeast-1.on.aws';

function buildTemplate(overrides?: ConstructorParameters<typeof EcsAppStack>[2]): Template {
  const app = new cdk.App();
  const stack = new EcsAppStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
    publicUrl: DEFAULT_TEST_URL,
    ...overrides,
  });
  return Template.fromStack(stack);
}

describe('EcsAppStack', () => {
  test('ExpressGatewayService が 1 個だけ生成される(従来 Fargate Service との混同無し)', () => {
    const template = buildTemplate();
    template.resourceCountIs('AWS::ECS::ExpressGatewayService', 1);
    // 旧来の AWS::ECS::Service は 0 (ExpressGatewayService は別 type)
    template.resourceCountIs('AWS::ECS::Service', 0);
  });

  test('Service の cpu/memory/healthCheckPath/serviceName が LT 構成と一致', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
      ServiceName: 'lt-jaws-ecs',
      Cpu: '256',
      Memory: '512',
      HealthCheckPath: '/health',
    });
  });

  test('primaryContainer に containerPort=8080 と PUBLIC_URL/PORT 環境変数が乗る', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
      PrimaryContainer: Match.objectLike({
        ContainerPort: 8080,
        Environment: Match.arrayWith([
          { Name: 'PUBLIC_URL', Value: DEFAULT_TEST_URL },
          { Name: 'PORT', Value: '8080' },
          { Name: 'NODE_ENV', Value: 'production' },
        ]),
      }),
    });
  });

  test('LogGroup を明示作成し、Service の awsLogsConfiguration が参照する', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 7, // ONE_WEEK
    });
    template.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
    template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
      PrimaryContainer: Match.objectLike({
        AwsLogsConfiguration: Match.objectLike({
          LogStreamPrefix: 'lt-jaws-ecs',
        }),
      }),
    });
  });

  test('Execution Role: trust=ecs-tasks, AmazonECSTaskExecutionRolePolicy 付与', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Service: 'ecs-tasks.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }),
        ]),
      }),
      ManagedPolicyArns: Match.arrayWith([
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
            ],
          ],
        },
      ]),
    });
  });

  test('Infrastructure Role: trust=ecs, AmazonECSInfrastructureRoleforExpressGatewayServices 付与', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Service: 'ecs.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }),
        ]),
      }),
      ManagedPolicyArns: Match.arrayWith([
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices',
            ],
          ],
        },
      ]),
    });
  });

  test('VPC は 2 AZ public-only / NAT GW 0', () => {
    const template = buildTemplate();
    template.resourceCountIs('AWS::EC2::VPC', 1);
    // 2 AZ × public-only = 2 サブネット
    template.resourceCountIs('AWS::EC2::Subnet', 2);
    // NAT GW は作らない($33/AZ/月の節約)
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    // IGW は 1 つ
    template.resourceCountIs('AWS::EC2::InternetGateway', 1);
  });

  test('Service には Runtime=ecs-express タグが明示付与される', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
      Tags: Match.arrayWith([{ Key: 'Runtime', Value: 'ecs-express' }]),
    });
  });

  test('LogGroup にも Runtime=ecs-express タグが付与される', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      Tags: Match.arrayWith([{ Key: 'Runtime', Value: 'ecs-express' }]),
    });
  });

  test('scalingTarget は min=max=1 で固定(LT デモ用)', () => {
    const template = buildTemplate();
    template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
      ScalingTarget: Match.objectLike({
        MinTaskCount: 1,
        MaxTaskCount: 1,
      }),
    });
  });

  test('CloudFormation Outputs に決定論的 URL と各種参照値が含まれる', () => {
    const template = buildTemplate();
    template.hasOutput('EcsUrl', {});
    template.hasOutput('EcsAttrEndpoint', {});
    template.hasOutput('EcsServiceName', {});
    template.hasOutput('EcsLogGroupName', {});
    template.hasOutput('EcsImageUri', {});
  });

  test('cpu/memory/containerPort/serviceName を上書きできる', () => {
    const template = buildTemplate({
      env: { account: '123456789012', region: 'ap-northeast-1' },
      publicUrl: DEFAULT_TEST_URL,
      cpu: '1024',
      memory: '2048',
      containerPort: 3000,
      serviceName: 'lt-jaws-ecs-staging',
    });
    template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
      ServiceName: 'lt-jaws-ecs-staging',
      Cpu: '1024',
      Memory: '2048',
      PrimaryContainer: Match.objectLike({
        ContainerPort: 3000,
        Environment: Match.arrayWith([{ Name: 'PORT', Value: '3000' }]),
      }),
    });
  });

  test('Stack タグ(Project / Owner / Purpose / Runtime) が cdk.Tags 経由で取得できる', () => {
    // explicitStackTags ON では Stack タグは個別リソースの CFN テンプレに乗らない。
    // 「タグ自体が設定されている事実」だけを Stack オブジェクト経由で検証する。
    const app = new cdk.App();
    const stack = new EcsAppStack(app, 'TaggedStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      publicUrl: DEFAULT_TEST_URL,
      tags: {
        Project: 'jaws-ug-lt',
        Owner: 'takabo',
        Purpose: 'lt-slide-hosting',
        Runtime: 'ecs-express',
      },
    });

    const stackTags = stack.tags.tagValues();
    expect(stackTags).toMatchObject({
      Project: 'jaws-ug-lt',
      Owner: 'takabo',
      Purpose: 'lt-slide-hosting',
      Runtime: 'ecs-express',
    });
  });
});
