import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'node:path';

/**
 * {@link EcsAppStack} のプロパティ。
 *
 * `cdk-app/lib/cdk-app-stack.ts` の {@link import('../../cdk-app/lib/cdk-app-stack').CdkAppStackProps} と
 * **意図的に同じ粒度** で書いてある。これにより LT で「Lambda 版と ECS 版で
 * 設定オプションのナナメ比較がそのままできる」ことを示せる。
 *
 * 「ちゃんとした IaC 感」を出すために型を切ってあるだけで、LT 用途では全部
 * デフォルト値で十分動く。
 */
export interface EcsAppStackProps extends cdk.StackProps {
  /**
   * Fargate タスクの CPU 割り当て(vCPU units, 文字列指定。 ECS Express の CFN フィールドが string)。
   *
   * Fargate の最小サイズ。Lambda 版(512MB)と memory を揃えてコスト/性能をフェアに比較するために
   * 256/512 の組合せを採用。
   *
   * @default '256'
   */
  readonly cpu?: string;

  /**
   * Fargate タスクのメモリ(MB, 文字列)。
   *
   * @default '512'
   */
  readonly memory?: string;

  /**
   * コンテナがリッスンするポート。
   *
   * Hono の `@hono/node-server` を `runtime/server.ts` で `PORT` 環境変数から読むので、
   * ここで指定した値が `PORT` 環境変数として注入され、コンテナリスナと一致する。
   *
   * @default 8080
   */
  readonly containerPort?: number;

  /**
   * ALB ヘルスチェックのパス。
   *
   * `shared/app.ts` が `/health` に runtime/timestamp/publicUrl を返す JSON を実装済み。
   * ECS Express デフォルトは `HTTP:80/ping` なので **必ず上書きする**。
   *
   * @default '/health'
   */
  readonly healthCheckPath?: string;

  /**
   * ECS サービス名(クラスタ内ユニーク)。
   *
   * 注: 公式ドキュメントには「URL = `https://<serviceName>.ecs.<region>.on.aws/`」と書いてあるが、
   * 実測では **`https://<truncatedPrefix>-<32hex>.ecs.<region>.on.aws/` 形式の URL が
   * AWS から自動発行される** 。 serviceName で完全に決定論的に決まるわけではない
   * (Lambda Function URL と同様、デプロイ後に CfnOutput の `EcsAttrEndpoint` で取得)。
   *
   * @default 'lt-jaws-ecs'
   */
  readonly serviceName?: string;

  /**
   * 起動するタスク数(min/max)。
   *
   * LT 用途なので 1 タスク固定(コールドスタートなし・コスト最小)。
   * 実運用なら `min=2, max=N` を推奨。
   *
   * @default { min: 1, max: 1 }
   */
  readonly scalingTarget?: { minTaskCount: number; maxTaskCount: number };

  /**
   * CloudWatch Logs の保持期間。LT スライドのログを長期保管する意味はないので最短。
   *
   * @default RetentionDays.ONE_WEEK
   */
  readonly logRetention?: logs.RetentionDays;

  /**
   * このデプロイの公開 URL(末尾スラ無し)。OGP / Twitter Card 用に Hono へ
   * 環境変数として渡される。`bin/ecs-app.ts` でデフォルト値が
   * `https://lt-jaws-ecs.ecs.ap-northeast-1.on.aws` に設定されているので、
   * serviceName をデフォルトのままにする限り 1-pass デプロイで OGP も埋まる。
   *
   * @default '' (OGP に絶対 URL が入らない劣化動作)
   */
  readonly publicUrl?: string;
}

/**
 * JAWS-UG LT 続編「机上の比較から、実地の検証へ」のスライド一式を、
 * **Amazon ECS Express Mode** (Fargate + 自動管理 ALB) で配信する CDK Stack。
 *
 * ## 構成
 *
 * - 自前 VPC (maxAzs=2, **natGateways=0**, public subnet ×2)
 *   - NAT GW を持たないことで月 \~$33 のコストを削れる代わりに、タスクは
 *     `assignPublicIp` 相当で public subnet に配置され、IGW 経由で ECR / CloudWatch に直接出る。
 * - ECS {@link ecs.Cluster}
 * - 2 つの IAM Role:
 *   - **Task Execution Role** : `ecs-tasks.amazonaws.com` を信頼、
 *     `AmazonECSTaskExecutionRolePolicy` (ECR pull / CloudWatch Logs 書き) を付与
 *   - **Infrastructure Role** : `ecs.amazonaws.com` を信頼、
 *     `AmazonECSInfrastructureRoleforExpressGatewayServices` (ECS が ALB/SG/SSL を
 *     裏で作るために必要) を付与
 * - {@link logs.LogGroup} (1 週間保持、`RemovalPolicy.DESTROY`)
 * - {@link DockerImageAsset} (build context = リポジトリルート、Dockerfile = `ecs-app/runtime/Dockerfile`)
 *   - esbuild bundle で `dist/server.js` 単一ファイル化、静的ファイル(HTML / 画像 / 音声) 同梱
 *   - Platform は **linux/amd64** 固定 (ApplePlatform Silicon dev でも互換確保)
 * - L1 {@link CfnExpressGatewayService} 1 個
 *   - cpu/memory/containerPort/healthCheckPath/serviceName を明示
 *   - networkConfiguration: 自前 VPC の public subnets を選択
 *   - scalingTarget: min=max=1 (LT デモ用の固定値)
 *   - `Runtime=ecs-express` タグを Service レベルで付与 (Cost Explorer 比較用)
 *
 * ## cdk-app/ との関係
 *
 * このスタックは前回 LT 「お前の Lambda それ API サーバーちゃうで」(`cdk-app/`) の
 * **対(つい)** として作っている。`shared/app.ts` の Hono アプリ本体は **完全に同じインスタンス** を、
 *   - cdk-app/ → `hono/aws-lambda` アダプタで Lambda 上でホスト
 *   - ecs-app/ → `@hono/node-server` で ECS Express 上でホスト
 * という違いだけ。インフラ層 (この Stack) だけを差し替え、アプリ層は 1 ミリも変えない。
 *
 * LT で出す比較軸 (コード行数 / CFN リソース数 / 月額コスト / RPS / P99) の **純度** を
 * 保つために、この構造的対称性が決定的に効く。
 */
export class EcsAppStack extends cdk.Stack {
  /** 自前 VPC(public subnets ×2, NAT GW なし)。 */
  public readonly vpc: ec2.Vpc;

  /** ECS クラスタ。LT 用なので 1 サービスしか乗らない。 */
  public readonly cluster: ecs.Cluster;

  /** タスク実行ロール (ECR pull / CloudWatch Logs 書き)。 */
  public readonly executionRole: iam.Role;

  /** ECS Express Mode が ALB / SG / SSL を裏で管理するためのロール。 */
  public readonly infrastructureRole: iam.Role;

  /** タスク用 SG(VPC 内からの container port 受け入れ + 全アウトバウンド許可)。 */
  public readonly taskSecurityGroup: ec2.SecurityGroup;

  /** 明示的に作成する LogGroup。CDK の暗黙生成に頼らず参照可能にしておく。 */
  public readonly logGroup: logs.LogGroup;

  /** Docker イメージのアセット(リポジトリルートをコンテキストに esbuild bundle)。 */
  public readonly image: DockerImageAsset;

  /** ECS Express Mode サービス本体(L1; L2 はまだ未提供)。 */
  public readonly service: ecs.CfnExpressGatewayService;

  /** 決定論的に発行される公開 URL(`https://<serviceName>.ecs.<region>.on.aws/`)。 */
  public readonly publicUrl: string;

  public constructor(scope: Construct, id: string, props?: EcsAppStackProps) {
    super(scope, id, props);

    const cpu = props?.cpu ?? '256';
    const memory = props?.memory ?? '512';
    const containerPort = props?.containerPort ?? 8080;
    const healthCheckPath = props?.healthCheckPath ?? '/health';
    const serviceName = props?.serviceName ?? 'lt-jaws-ecs';
    const scalingTarget = props?.scalingTarget ?? { minTaskCount: 1, maxTaskCount: 1 };
    const retention = props?.logRetention ?? logs.RetentionDays.ONE_WEEK;
    const publicUrlFromProps = props?.publicUrl ?? '';

    this.publicUrl = publicUrlFromProps;

    this.vpc = this.createVpc();
    this.cluster = this.createCluster(this.vpc);
    this.executionRole = this.createExecutionRole();
    this.infrastructureRole = this.createInfrastructureRole();
    this.logGroup = this.createLogGroup(retention);
    this.taskSecurityGroup = this.createTaskSecurityGroup(this.vpc, containerPort);
    this.image = this.createImage();

    this.service = this.createService({
      cluster: this.cluster,
      executionRole: this.executionRole,
      infrastructureRole: this.infrastructureRole,
      logGroup: this.logGroup,
      taskSecurityGroup: this.taskSecurityGroup,
      image: this.image,
      cpu,
      memory,
      containerPort,
      healthCheckPath,
      serviceName,
      scalingTarget,
      publicUrl: publicUrlFromProps,
    });

    // LogGroup にも Runtime タグを明示的に付与する(`@aws-cdk/core:explicitStackTags`
    // フラグ ON では Stack 直下の tags は個別リソースの CFN テンプレに乗らないため)。
    // ExpressGatewayService 側は constructor props で渡したタグが直接乗る。
    const cfnLogGroup = this.logGroup.node.defaultChild as logs.CfnLogGroup;
    cfnLogGroup.tags.setTag('Runtime', 'ecs-express');

    this.exportOutputs();
  }

  /**
   * 自前最小 VPC を作る。
   *
   * - 2 AZ(東京リージョンの最小冗長)
   * - NAT GW なし($33/AZ/月の節約)
   * - public subnet のみ。タスクは public subnet に置かれ IGW 経由で ECR / CloudWatch に出る
   * - default SG はクローズドにする(CDK の `restrictDefaultSecurityGroup` 推奨設定)
   */
  private createVpc(): ec2.Vpc {
    return new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
      restrictDefaultSecurityGroup: true,
      vpcName: `${cdk.Stack.of(this).stackName}-Vpc`,
    });
  }

  /** ECS クラスタ。LT 用途では 1 サービスのみ収容。 */
  private createCluster(vpc: ec2.Vpc): ecs.Cluster {
    return new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: `${cdk.Stack.of(this).stackName}-Cluster`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
  }

  /**
   * Task Execution Role を作る。
   *
   * Trust: `ecs-tasks.amazonaws.com`
   * Managed Policy: `AmazonECSTaskExecutionRolePolicy`
   *   (ECR pull + CloudWatch Logs 書き)
   */
  private createExecutionRole(): iam.Role {
    return new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS Express task execution role (ECR pull + CW Logs write)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });
  }

  /**
   * Infrastructure Role を作る。
   *
   * Trust: **`ecs.amazonaws.com`** (Express Mode 専用、`ecs-tasks` ではない)
   * Managed Policy: `AmazonECSInfrastructureRoleforExpressGatewayServices`
   *   (ECS が ALB/SG/SSL/AutoScaling を裏で provision するために必要)
   */
  private createInfrastructureRole(): iam.Role {
    return new iam.Role(this, 'InfrastructureRole', {
      assumedBy: new iam.ServicePrincipal('ecs.amazonaws.com'),
      description:
        'ECS Express infrastructure role (lets ECS manage ALB/SG/SSL/AutoScaling on your behalf)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSInfrastructureRoleforExpressGatewayServices',
        ),
      ],
    });
  }

  /**
   * LogGroup を明示的に作成。
   *
   * cdk-app/ の Lambda 側と同じ理由(deprecated な暗黙生成を避け、保持期間を 1 週間に制限)。
   */
  private createLogGroup(retention: logs.RetentionDays): logs.LogGroup {
    return new logs.LogGroup(this, 'TaskLogs', {
      retention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  /**
   * タスク ENI に付ける SG。
   *
   * - **Ingress**: VPC CIDR 内からのみ container port 受け入れ
   *   (ECS Express が裏で立てる ALB は同 VPC 内に居るので、これで届く)
   * - **Egress**: 全許可 (ECR pull / CloudWatch Logs / 任意の外部呼び出し)
   */
  private createTaskSecurityGroup(vpc: ec2.Vpc, containerPort: number): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc,
      // AWS EC2 SG description は ASCII only、かつ許可文字セットが
      // `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*` に限られる。`>` や `→` は弾かれるため、
      // 「to」と素直に書く。256 文字以内も注意。
      description: 'ECS Express task ENI SG: allow ALB to task on container port',
      allowAllOutbound: true,
    });
    sg.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(containerPort),
      'ALB(in-VPC) to task',
    );
    return sg;
  }

  /**
   * Docker イメージのアセット。
   *
   * - build context = リポジトリルート (`shared/` と `ecs-app/runtime/` の両方を COPY したいため)
   * - Dockerfile = `ecs-app/runtime/Dockerfile`
   * - platform: linux/amd64 固定 (ECS Fargate は x86 を既定としているため、
   *   Apple Silicon dev で arm64 ビルドが混入しないよう明示)
   */
  private createImage(): DockerImageAsset {
    const repoRoot = path.join(__dirname, '..', '..');
    return new DockerImageAsset(this, 'ImageAsset', {
      directory: repoRoot,
      file: 'ecs-app/runtime/Dockerfile',
      platform: Platform.LINUX_AMD64,
      // この値が `linux/amd64` であることを CFN テンプレ上でも assertion 可能にするため、
      // assetName を付ける(synth 出力に出る)。
      assetName: 'lt-jaws-ecs-image',
    });
  }

  /**
   * `CfnExpressGatewayService` を作る。
   *
   * L1 のみ存在 (L2 は github.com/aws/aws-cdk/issues/36234 で要望中)。
   * L1 でも `string ARN` を取り回せば cluster / executionRole / infrastructureRole は
   * L2 から参照できるので、ボイラープレートは最小限。
   */
  private createService(args: {
    cluster: ecs.Cluster;
    executionRole: iam.Role;
    infrastructureRole: iam.Role;
    logGroup: logs.LogGroup;
    taskSecurityGroup: ec2.SecurityGroup;
    image: DockerImageAsset;
    cpu: string;
    memory: string;
    containerPort: number;
    healthCheckPath: string;
    serviceName: string;
    scalingTarget: { minTaskCount: number; maxTaskCount: number };
    publicUrl: string;
  }): ecs.CfnExpressGatewayService {
    const publicSubnetIds = args.cluster.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
    }).subnetIds;

    return new ecs.CfnExpressGatewayService(this, 'ExpressService', {
      serviceName: args.serviceName,
      // 注: ドキュメント上は cluster は "short name or full ARN" を受けるが、
      // ARN 形式 (modern: `arn:aws:ecs:region:account:cluster/name`) を渡すと
      // ECS Express API が "Invalid identifier: Unexpected number of separators" で弾く。
      // → クラスタ名(短名)を渡すと通る。
      cluster: args.cluster.clusterName,
      executionRoleArn: args.executionRole.roleArn,
      infrastructureRoleArn: args.infrastructureRole.roleArn,
      cpu: args.cpu,
      memory: args.memory,
      healthCheckPath: args.healthCheckPath,
      primaryContainer: {
        image: args.image.imageUri,
        containerPort: args.containerPort,
        environment: [
          // Hono に流して OGP / Twitter Card の絶対 URL を組み立てる。
          { name: 'PUBLIC_URL', value: args.publicUrl },
          // server.ts が listen するポート。コンテナポートと一致させる。
          { name: 'PORT', value: String(args.containerPort) },
          // Node ランタイム標準
          { name: 'NODE_ENV', value: 'production' },
          // source-map-support が無くても Node 自身でスタックトレース解析する
          { name: 'NODE_OPTIONS', value: '--enable-source-maps' },
        ],
        awsLogsConfiguration: {
          logGroup: args.logGroup.logGroupName,
          logStreamPrefix: 'lt-jaws-ecs',
        },
      },
      networkConfiguration: {
        subnets: publicSubnetIds,
        securityGroups: [args.taskSecurityGroup.securityGroupId],
      },
      scalingTarget: {
        minTaskCount: args.scalingTarget.minTaskCount,
        maxTaskCount: args.scalingTarget.maxTaskCount,
      },
      tags: [
        // Cost Explorer で「どっちのランタイムに張り付いてる料金か」を分離するため、
        // Stack タグに頼らず Service レベルにも明示する。
        { key: 'Runtime', value: 'ecs-express' },
      ],
    });
  }

  /**
   * CloudFormation Outputs を設定。
   *
   * cdk-app/ と対になる名前(`EcsUrl` / `EcsServiceName` / `EcsLogGroupName`)で揃える。
   */
  private exportOutputs(): void {
    // 実 URL は CFN attribute `EcsAttrEndpoint` から取れる (例: `lt-<32hex>.ecs.<region>.on.aws`)。
    // 公式ドキュメントが言う「`<serviceName>.ecs.<region>.on.aws`」形式は実測では発行されない:
    // AWS は serviceName の冒頭 + ハッシュ で固有の URL を auto-issue する。
    new cdk.CfnOutput(this, 'EcsUrl', {
      value: `https://${this.service.attrEndpoint}/`,
      description: 'JAWS-UG LT スライド公開URL(ECS Express Mode, AWS auto-issued)',
      exportName: `${this.stackName}-EcsUrl`,
    });

    // attrEndpoint の生値(プロトコルなし)。 cross-stack ref 用にも残す。
    new cdk.CfnOutput(this, 'EcsAttrEndpoint', {
      value: this.service.attrEndpoint,
      description: 'ECS Express service の DNS 名(プロトコルなし)',
      exportName: `${this.stackName}-EcsAttrEndpoint`,
    });

    new cdk.CfnOutput(this, 'EcsServiceName', {
      value: this.service.serviceName!,
      description: 'ECS Express service 名',
      exportName: `${this.stackName}-EcsServiceName`,
    });

    new cdk.CfnOutput(this, 'EcsLogGroupName', {
      value: this.logGroup.logGroupName,
      description: 'CloudWatch Logs LogGroup 名',
      exportName: `${this.stackName}-EcsLogGroupName`,
    });

    new cdk.CfnOutput(this, 'EcsImageUri', {
      value: this.image.imageUri,
      description: 'Fargate タスクが起動する Docker イメージ URI(ECR)',
    });
  }
}
