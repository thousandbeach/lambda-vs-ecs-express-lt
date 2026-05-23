import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'node:path';

/**
 * {@link CdkAppStack} のプロパティ。
 *
 * Lambda 関数のリソース割り当てやログ保持期間など、環境ごとに変えたくなりそうな値を外から注入する。
 *
 * 今回の LT 用途では全部デフォルト値で十分やが、「ちゃんとした IaC」感を出すために型を切ってある。
 */
export interface CdkAppStackProps extends cdk.StackProps {
  /**
   * Lambda 関数に割り当てるメモリサイズ(MB)。
   *
   * ハンドラ自体は軽量やが、Hono のロード + ファイル読み込みで 256MB やと初回起動が遅い。
   * 512MB が体感的にちょうどええ。
   *
   * @default 512
   */
  readonly lambdaMemorySize?: number;

  /**
   * Lambda 関数の最大実行時間。
   *
   * 静的ファイル配信のみなので 10 秒もあれば十分。これを超えるレスポンスは設計を疑うべき。
   *
   * @default Duration.seconds(10)
   */
  readonly lambdaTimeout?: cdk.Duration;

  /**
   * CloudWatch Logs の保持期間。
   *
   * LT スライドのログを長期保管する意味はないので、最短で消す。
   * コスト最適化と GDPR/個人情報保持の両面で短い方が望ましい。
   *
   * @default RetentionDays.ONE_WEEK
   */
  readonly logRetention?: logs.RetentionDays;

  /**
   * このデプロイの公開 URL(末尾スラ無し)。OGP/Twitter Card 用に Hono へ環境変数として渡される。
   *
   * Function URL は **作成後でないと URL が確定しない**ので、初回 `cdk deploy` だけ
   * 空文字でデプロイ → 出力された URL を `--context publicUrl=...` で再デプロイ、
   * という 2 段階で運用する。
   *
   * すでに本番稼働している URL がある場合は `bin/cdk-app.ts` でハードコードしておけば、
   * 通常の `cdk deploy` で OGP も埋まる。
   *
   * @default '' (OGP に絶対 URL が入らない劣化動作)
   */
  readonly publicUrl?: string;
}

/**
 * JAWS-UG LT「お前の Lambda それ API サーバーちゃうで」を、
 * その主張に反して Lambda + Hono で配信するための CDK Stack。
 *
 * ## 構成
 *
 * - {@link NodejsFunction} 1 つ
 *   - Hono アプリケーション本体は `../../shared/app.ts` を共通化(ECS 版と同じコードを動かす)
 *   - 静的ファイル(HTML / mp3 / icon) も esbuild の `commandHooks.afterBundling` で同じ zip に詰める
 * - Lambda Function URL(認証なし、API Gateway も使わない最小構成)
 * - {@link logs.LogGroup}(保持期間 1 週間、`RemovalPolicy.DESTROY`)
 *   - 旧コードの `logRetention` プロパティは deprecated 警告が出る + 余分な Lambda カスタムリソースを生むので、
 *     明示的に LogGroup を作って渡す形に書き直してある。
 *
 * ## メタな意図
 *
 * このスタックは技術的には **過剰設計** である。
 * 静的ファイル配信であれば S3 + CloudFront が AWS の正攻法。
 * 「Lambda を API/Web サーバーとして使うアンチパターン」を **意図的に** 実装し、
 * 同リポジトリの `ecs-app/` (ECS Express Mode) との比較対象とすることが目的。
 */
export class CdkAppStack extends cdk.Stack {
  /** 公開された Lambda Function URL。 deploy 完了後、CloudFormation Outputs に表示される。 */
  public readonly functionUrl: lambda.FunctionUrl;

  /** LT スライドを配信する Lambda 関数本体。 */
  public readonly handler: NodejsFunction;

  /** Lambda 専用 LogGroup(deprecated な logRetention を回避するため明示的に作成)。 */
  public readonly logGroup: logs.LogGroup;

  public constructor(scope: Construct, id: string, props?: CdkAppStackProps) {
    super(scope, id, props);

    const memorySize = props?.lambdaMemorySize ?? 512;
    const timeout = props?.lambdaTimeout ?? cdk.Duration.seconds(10);
    const retention = props?.logRetention ?? logs.RetentionDays.ONE_WEEK;
    const publicUrl = props?.publicUrl ?? '';

    this.logGroup = new logs.LogGroup(this, 'LtHandlerLogs', {
      // 関数名と紐づく `/aws/lambda/<funcName>` の予約名を CDK が自動付与するため、
      // logGroupName を指定すると衝突になりやすい。デフォルトに任せる。
      retention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.handler = this.createHandler({ memorySize, timeout, publicUrl });
    this.functionUrl = this.createFunctionUrl(this.handler);

    // 「どっちの runtime に張り付いてる料金/メトリクスか」を Cost Explorer / CloudWatch で
    // ぱっと識別できるよう、`Runtime` タグだけは Stack タグに頼らず明示する。
    //
    // `@aws-cdk/core:explicitStackTags` フラグ ON では Stack 直下の `tags` は
    // CFN テンプレートの各リソース `Tags` に注入されない(CFN deploy 時のスタックタグ経由で
    // AWS 側に伝播する)ため、テンプレ単体のアサーションに乗らない。
    //
    // また `cdk.Tags.of(construct).add()` は Aspect 経由で適用されるが、
    // `Template.fromStack()` 経路だと Aspect が走らず synth に乗らないケースが観測された。
    // そこで `TagManager` を **直接叩く** ことで両方の経路で確実にタグが入ることを保証する。
    const cfnFn = this.handler.node.defaultChild as lambda.CfnFunction;
    cfnFn.tags.setTag('Runtime', 'lambda');
    const cfnLogGroup = this.logGroup.node.defaultChild as logs.CfnLogGroup;
    cfnLogGroup.tags.setTag('Runtime', 'lambda');

    this.exportOutputs();
  }

  /**
   * Hono アプリケーションを実行する Lambda 関数を作成する。
   *
   * `lambda/index.ts` を esbuild でバンドルし、リポジトリルート直下の
   * 静的ファイル(HTML / mp3 / icon / ogp) を `bundling.commandHooks.afterBundling` で
   * zip パッケージに含める。
   *
   * 旧版は `lambda/public/` 配下に複製を持っていたが、OGP メタの差分のみで二重管理が発生していた。
   * 今は **リポジトリルートの 1 セットだけが正本** で、ここでビルド時に同梱する。
   */
  private createHandler(config: {
    memorySize: number;
    timeout: cdk.Duration;
    publicUrl: string;
  }): NodejsFunction {
    // リポジトリルートからの相対パスで静的ファイルをコピーする。
    // inputDir = cdk-app/ なので、`${inputDir}/..` がリポジトリルート。
    const copyAssets = (inputDir: string, outputDir: string): string[] => {
      const repoRoot = `${inputDir}/..`;
      return [
        `mkdir -p ${outputDir}/public/audio ${outputDir}/public/audio-ecs`,
        `cp ${repoRoot}/lt-jaws-audio-prerecorded-final2.html ${outputDir}/public/index.html`,
        // 次回 LT のスライドが存在すれば同梱(初回 LT 単体運用時は無くてもデプロイは通る)。
        `[ -f ${repoRoot}/lt-jaws-ecs-migration.html ] && cp ${repoRoot}/lt-jaws-ecs-migration.html ${outputDir}/public/ecs.html || true`,
        `cp ${repoRoot}/icon.jpg ${outputDir}/public/icon.jpg`,
        `cp ${repoRoot}/ogp.jpg ${outputDir}/public/ogp.jpg`,
        `cp ${repoRoot}/audio/*.mp3 ${outputDir}/public/audio/ 2>/dev/null || true`,
        `[ -d ${repoRoot}/audio-ecs ] && cp ${repoRoot}/audio-ecs/*.mp3 ${outputDir}/public/audio-ecs/ 2>/dev/null || true`,
      ];
    };

    const props: NodejsFunctionProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'index.ts'),
      handler: 'handler',
      memorySize: config.memorySize,
      timeout: config.timeout,
      logGroup: this.logGroup,
      environment: {
        // OGP / Twitter Card の絶対 URL 生成に使う(空でも起動はする)。
        PUBLIC_URL: config.publicUrl,
        // Node.js のメモリ確保や Hono の挙動には影響ないが、何かあったら判別したいので残す。
        NODE_OPTIONS: '--enable-source-maps',
      },
      description:
        'LT slide host (Lambda + Hono). Intentionally an anti-pattern; see CdkAppStack JSDoc.',
      bundling: {
        // 静的ファイルを Lambda パッケージに同梱する。
        // これが「Lambda の 250MB パッケージ上限」を体感する装置でもある。
        // 5.6MB 程度なので今回は問題にならないが、本来 S3 + CloudFront で配信すべき。
        commandHooks: {
          beforeBundling: (): string[] => [],
          beforeInstall: (): string[] => [],
          afterBundling: copyAssets,
        },
      },
    };

    return new NodejsFunction(this, 'LtHandler', props);
  }

  /**
   * Lambda Function URL を作成する。
   *
   * API Gateway / CloudFront / ALB を一切使わない最小構成。
   * 認証は無効(誰でもアクセス可能)。LT 公開用途として妥当。
   */
  private createFunctionUrl(handler: NodejsFunction): lambda.FunctionUrl {
    return handler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
  }

  /**
   * CloudFormation Outputs を設定する。
   *
   * deploy 完了時にコンソールへ表示され、CLI からも
   * `aws cloudformation describe-stacks` で取得できる。
   */
  private exportOutputs(): void {
    new cdk.CfnOutput(this, 'LtUrl', {
      value: this.functionUrl.url,
      description: 'JAWS-UG LT スライド公開URL(Lambda + Function URL)',
      exportName: `${this.stackName}-LtUrl`,
    });

    new cdk.CfnOutput(this, 'LtHandlerName', {
      value: this.handler.functionName,
      description: 'Lambda 関数名(CloudWatch Logs / メトリクス参照用)',
      exportName: `${this.stackName}-LtHandlerName`,
    });

    new cdk.CfnOutput(this, 'LtLogGroupName', {
      value: this.logGroup.logGroupName,
      description: 'CloudWatch Logs LogGroup 名',
      exportName: `${this.stackName}-LtLogGroupName`,
    });
  }
}
