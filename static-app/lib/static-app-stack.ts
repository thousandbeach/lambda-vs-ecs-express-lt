import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'node:path';

export interface StaticAppStackProps extends cdk.StackProps {
  /**
   * S3 にアップロードする静的ファイルのソースディレクトリ。
   * デフォは `../dist` (リポジトリ ルートからは `static-app/dist`)。
   * `npm run build:html` で生成される。
   *
   * @default '../dist'
   */
  readonly distDir?: string;

  /**
   * CloudFront のキャッシュ TTL。 LT アーカイブ用途なので長めに、 deploy 時の
   * invalidation で即時上書きする運用。
   *
   * @default Duration.hours(1)
   */
  readonly defaultTtl?: cdk.Duration;
}

/**
 * LT スライド (Part I / Part II / 自己紹介) を **S3 + CloudFront** で静的配信する Stack。
 *
 * ## 由来 (アフター状態)
 *
 * このスタックは前回 LT 「お前の Lambda それ API サーバーちゃうで」 + 続編 LT
 * 「机上の比較から、実地の検証へ — ECS Express 移行レポート」 の **アフター** に位置する。
 *
 * 両 LT で「**静的配信なら S3 + CloudFront 一発が正解**」 と繰り返し主張した上で、
 * LT 自体は意図的にアンチパターン (Lambda + Hono、 ECS Express + Fargate) で配信していた。
 * LT 終了後、 本スタックで主張通りの正解構成に着地させ、 Lambda 版 + ECS 版を `cdk destroy`。
 *
 * ## 構成
 *
 * - `s3.Bucket` (Private + Block Public Access + EnforceSSL)
 * - `cloudfront.Distribution` with **Origin Access Control (OAC)** で S3 を参照
 * - `s3deploy.BucketDeployment` で `dist/` (pre-rendered HTML + assets) を一括 upload
 * - `errorResponses` で 404 を Part II (`/ecs.html`) にフォールバック
 *
 * ## 月額予想 (Tokyo, LT 規模 ~1000 req/月)
 *
 * - S3 storage ($0.025/GB) × ~13MB           = ~$0.0003
 * - CF data transfer ($0.114/GB) × ~13MB     = ~$0.0015
 * - CF requests ($0.0090/10k)               = ~$0.001
 * - Route 53 / その他                        = 0
 * - **合計 約 $0.01〜0.10/月** (Lambda + ECS の $19〜21 から 99% 削減)
 */
export class StaticAppStack extends cdk.Stack {
  /** 静的アセット保管バケット (Private + OAC)。 */
  public readonly bucket: s3.Bucket;

  /** CloudFront ディストリビューション。 */
  public readonly distribution: cloudfront.Distribution;

  public constructor(scope: Construct, id: string, props?: StaticAppStackProps) {
    super(scope, id, props);

    const distDir = props?.distDir ?? path.join(__dirname, '..', 'dist');
    const defaultTtl = props?.defaultTtl ?? cdk.Duration.hours(1);

    // ── S3: Private bucket (CloudFront OAC からのみアクセス可) ─────────
    this.bucket = new s3.Bucket(this, 'AssetBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          // 古い version は 30 日で消す (versioning は無効にしているので noop だが、 設定例として)
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // ── CloudFront: OAC で S3 を参照 ────────────────────────────────
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // HTTPS デフォルトに、 GET/HEAD/OPTIONS のみ許可 (POST 不要)
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy: new cloudfront.CachePolicy(this, 'DefaultCachePolicy', {
          defaultTtl,
          maxTtl: cdk.Duration.days(30),
          minTtl: cdk.Duration.seconds(0),
          enableAcceptEncodingGzip: true,
          enableAcceptEncodingBrotli: true,
          headerBehavior: cloudfront.CacheHeaderBehavior.none(),
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
          cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        }),
        compress: true,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      // ルート (/) を叩いた時に返すファイル。 Part II をメインに。
      defaultRootObject: 'index.html',
      errorResponses: [
        // 存在しないパスは Part II にフォールバック (SPA 風)。
        // ただし audio / 画像 の 404 はそのまま 404 で返す方が誠実だが、
        // CF 側は path-based の error handling が無いので、 一律 index.html へ。
        // (slide HTML から間違ったパス踏んでもページが返るだけ。 安全)
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // 日本 + アジア + 米国エッジ (Tokyo 含む)
      enableLogging: false, // LT 用途では不要
      comment: 'LT slide static hosting (Part I + Part II + self-intro)',
    });

    // ── BucketDeployment: dist/ を一括 upload + CF invalidation ───────
    new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(distDir)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      // すべての object に共通の Cache-Control。 個別調整が要れば
      // 複数 BucketDeployment に分けて使い分ける。
      cacheControl: [
        s3deploy.CacheControl.setPublic(),
        s3deploy.CacheControl.maxAge(cdk.Duration.hours(1)),
      ],
      memoryLimit: 512,
    });

    // ── Outputs ─────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'StaticUrl', {
      value: `https://${this.distribution.distributionDomainName}/`,
      description: 'CloudFront URL (LT スライド配信先・最終形)',
      exportName: `${this.stackName}-StaticUrl`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID (キャッシュ手動 invalidation 用)',
      exportName: `${this.stackName}-DistributionId`,
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 Bucket 名 (中身を `aws s3 ls` 等で覗く用)',
      exportName: `${this.stackName}-BucketName`,
    });
  }
}
