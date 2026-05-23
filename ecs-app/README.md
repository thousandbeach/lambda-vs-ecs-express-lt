# ecs-app — [ARCHIVED] LT 当日 ECS Express 配信スタック

> 📜 **このスタックは 2026-05-23 に `cdk destroy` 済です**。 LT 当日のみ稼働。
> 現在の配信は [`../static-app/`](../static-app/) (S3+CloudFront) に移行。
> このディレクトリの IaC / コードは LT の **実地検証履歴** として残してあります。

JAWS-UG LT 続編「**机上の比較から、実地の検証へ — ECS Express 移行レポート**」のスライド一式を、
**Amazon ECS Express Mode** (Fargate + 自動管理 ALB) で配信するための AWS CDK プロジェクト。

> ✅ **これは LT で言っていた "Web/API 用途の正攻法" 配信構成です。**
> 前回 LT 「お前の Lambda それ API サーバーちゃうで」(`../cdk-app/`) が
> **意図的にアンチパターン**(Lambda + Hono で静的ファイル配信)を踏み抜いたのに対して、
> こちらは Web/API サーバー用途の正攻法 = ECS Express Mode の実証実装。
> 同じ `shared/app.ts` (Hono アプリ本体) を、ホスト層だけ差し替えて両方動かしていた(LT 当日)。
>
> なお **「静的配信そのものの正解」 は S3 + CloudFront** という別の話で、
> 現在のリポジトリ archive はそちら(`../static-app/`)で配信中。

詳しくは [親 README](../README.md) と [cdk-app/README.md](../cdk-app/README.md) を参照。

> 💡 **再デプロイしたい場合**: 通常通り `npm install && npx cdk deploy` で復元可能。
> ただし常時稼働コスト 月 $17〜20、 + Container Insights v2 課金あり。 LT 検証の再演目的のみ推奨。

---

## 🏗 構成

```
                ┌──────────────────┐
                │   Browser / SNS  │
                └────────┬─────────┘
                         │ HTTPS (auto SSL/TLS)
                         ▼
        ┌────────────────────────────────────────┐
        │  ECS Express Mode が裏で立てる ALB    │
        │  (共有 ALB; 最大 25 サービスで shared)  │
        │  https://lt-jaws-ecs.ecs.<region>.on.aws/ │
        └────────┬───────────────────────────────┘
                 │ HTTP :8080
                 ▼
   ┌────────────────────────────────────────┐
   │  Fargate Task (cpu=256 / mem=512)      │
   │  ┌──────────────────────────────────┐  │
   │  │  Hono (`@hono/node-server`)      │  │
   │  │  shared/app.ts → runtime=ecs-express│  │
   │  │                                  │  │
   │  │  GET /        → HTML (前回 LT)   │  │
   │  │  GET /ecs     → HTML (今回 LT)   │  │
   │  │  GET /icon.jpg /ogp.jpg          │  │
   │  │  GET /audio/:f      (前回音声)    │  │
   │  │  GET /audio-ecs/:f  (今回音声)    │  │
   │  │  GET /health    → JSON           │  │
   │  └──────────────────────────────────┘  │
   │                                        │
   │  /app/                                 │
   │  ├── server.js          (esbuild bundle)│
   │  └── public/                            │
   │      ├── index.html      (前回 LT)      │
   │      ├── ecs.html        (今回 LT)      │
   │      ├── icon.jpg / ogp.jpg             │
   │      ├── audio/slide_*.mp3              │
   │      └── audio-ecs/slide_*.mp3          │
   └────────────────────────────────────────┘
                         │ logs
                         ▼
            ┌──────────────────────────┐
            │  CloudWatch Logs (7日)   │
            └──────────────────────────┘
```

### ECS Express Mode が **自動で** やってくれること

| 項目 | 中身 |
|---|---|
| HTTPS endpoint | `https://<serviceName-prefix>-<32hex>.ecs.<region>.on.aws/`(ACM 証明書も AWS が発行)<br>※ドキュメントは `<serviceName>.ecs...` と書くが、実測ではプレフィックス + ハッシュ |
| 共有 ALB | 同一ネットワーク設定の Express サービスを最大 25 まで 1 つの ALB に集約 |
| 5XX ロールバック | デフォルトで 5XX 増加検知 → 自動 rollback / canary |
| 自動スケール | CPU/メモリ/リクエスト数ベース。今回は LT 用に min=max=1 で抑制 |
| 監視 | CloudWatch メトリクス + ALB アクセスログ |
| セキュリティグループ | ALB SG は ECS が自動管理。タスク SG は本 Stack で自前作成 |

### 採用しなかった選択肢(と、その理由)

| 選択肢 | 採用しなかった理由 |
|---|---|
| **EKS / Kubernetes** | 静的ファイル配信に Kubernetes 持ち出すのは過剰 |
| **ECS (旧来の Service + ALB 手動)** | コードが 3 倍。Express Mode の存在意義そのもの |
| **App Runner** | 2025/4/30 で新規受付終了。これがそもそも ECS Express の登場理由 |
| **Cloud Run** | AWS 縛り(本リポジトリは AWS でやりきる方針) |
| **デフォルト VPC を流用** | アカウントによっては default VPC が無いので、再現性のため自前で作る |
| **NAT GW を立てる** | $33/AZ/月 + LT 用途には不要。タスクは public subnet に直置きして IGW 経由で ECR pull |

---

## 📂 ディレクトリ構成

```
ecs-app/
├── README.md                  ← このファイル
├── package.json               (CDK + テスト依存; @hono/node-server は root に置く)
├── tsconfig.json              (cdk-app と同じ設定)
├── jest.config.js             (ts-jest, .ts 優先解決)
├── cdk.json                   (`npx ts-node bin/ecs-app.ts`)
├── .gitignore / .npmignore
│
├── bin/
│   └── ecs-app.ts             ← CDK エントリポイント
│                                 - account/region 解決 (cdk-app と同パターン)
│                                 - DEFAULT_ECS_PUBLIC_URL ハードコード
│                                 - Stack tags (Project / Owner / Purpose / PreviousStep / Runtime)
│
├── lib/
│   └── ecs-app-stack.ts       ← Stack 定義本体
│                                 - 自前 VPC (NAT=0 / public×2)
│                                 - Cluster + ExecRole + InfraRole + LogGroup + SG
│                                 - CfnExpressGatewayService (L1; L2 未提供)
│                                 - DockerImageAsset (build context = repo root)
│
├── runtime/
│   ├── Dockerfile             ← multi-stage; build stage で esbuild bundle
│   │                            runtime stage は node:20-slim + bundle 1 ファイル + public/
│   └── server.ts              ← Hono を `@hono/node-server` で 8080 にホスト
│                                 + SIGTERM/SIGINT graceful shutdown
│
└── test/
    └── ecs-app-stack.test.ts  ← Template-level アサーション(12 本)
```

---

## 🚀 デプロイ

### 前提

- Node.js 20.x 以上 / npm 10.x 以上
- AWS CLI v2 認証設定済み (account `xxxxxxxxxxxx` / `ap-northeast-1`)
- Docker Desktop 起動中 (DockerImageAsset の build に必要)
- CDK v2 (`npm install -g aws-cdk` または `npx cdk`)
- 必要 IAM 権限: CloudFormation / IAM / ECS / EC2 (VPC) / Logs / ECR / SSM の作成・更新

### 初回セットアップ

```bash
# 依存パッケージ (root + ecs-app/ 両方)
( cd .. && npm install )
npm install

# 東京リージョンで CDK Bootstrap (アカウント × リージョンごとに 1 回でよい)
export AWS_REGION=ap-northeast-1
export AWS_DEFAULT_REGION=ap-northeast-1
npx cdk bootstrap
```

> 💡 cdk-app/ で既に `cdk bootstrap` 済みなら不要。同じ bootstrap スタックを共用する。

### デプロイ

```bash
# TypeScript ビルド
npm run build

# 変更内容を確認(任意)
npx cdk diff

# デプロイ実行
npx cdk deploy

# IAM 差分の自動承認も可
npx cdk deploy --require-approval never
```

成功すると以下が出力される:

```
Outputs:
LtJawsEcsExpressStack.EcsUrl = https://lt-jaws-ecs.ecs.ap-northeast-1.on.aws/
LtJawsEcsExpressStack.EcsAttrEndpoint = lt-jaws-ecs.ecs.ap-northeast-1.on.aws
LtJawsEcsExpressStack.EcsServiceName = lt-jaws-ecs
LtJawsEcsExpressStack.EcsLogGroupName = /aws/ecs/LtJawsEcsExpressStack-TaskLogs...
LtJawsEcsExpressStack.EcsImageUri = xxxxxxxxxxxx.dkr.ecr.ap-northeast-1.amazonaws.com/...
```

`EcsUrl` がスライド公開 URL。
**serviceName を変更しない限り URL は不変** (Lambda Function URL のような destroy → 再 deploy で
URL が変わる挙動はない)。

### 静的ファイルだけ更新したい場合

`audio-ecs/`、`lt-jaws-ecs-migration.html`、その他静的素材を更新したら:

```bash
npm run build
npx cdk deploy --require-approval never
```

DockerImageAsset がコンテンツ変更を検知して再 build → ECR push → タスク差し替え。
service の Endpoint は不変。

### 削除

```bash
npx cdk destroy
```

⚠️ `cdk destroy` で消えるのは VPC / Cluster / Roles / LogGroup / SG / Express service のみ。
ECR レジストリと CDK が staging に使う S3 オブジェクトは残るので、完全に綺麗にしたいなら
`npx cdk bootstrap` で作った Bootstrap スタックも別途消す必要がある。

---

## 🔧 開発

### ローカル動作確認(Docker)

```bash
# Docker context = リポジトリルート に注意
cd ..  # repo root に降りる
docker build -f ecs-app/runtime/Dockerfile -t lt-jaws-ecs:dev .

# ローカル起動 (PUBLIC_URL は OGP に絶対 URL 入れたい時だけ)
docker run --rm -p 8080:8080 -e PUBLIC_URL=http://localhost:8080 lt-jaws-ecs:dev

# 別ターミナルから疎通
curl -s http://localhost:8080/health | jq
# → { "ok": true, "runtime": "ecs-express", "publicUrl": "http://localhost:8080", ... }
open http://localhost:8080/      # 前回 LT スライド
open http://localhost:8080/ecs   # 今回 LT スライド (WIP の間は stub HTML)
```

### TypeScript ビルド + 単体テスト

```bash
npm run build      # tsc(エラーなければ無出力)
npm test           # jest(Template-level アサーション12本)
```

> `npm test` も内部で **Docker daemon を必要とする**(DockerImageAsset の bundling のため)。
> Docker が起動していない場合は jest テストが失敗するので、Docker Desktop を起動してから実行する。

### CloudFormation テンプレート確認

```bash
npx cdk synth
# cdk.out/LtJawsEcsExpressStack.template.json に出力される
```

### ログ確認

```bash
# 関数名は cdk deploy の Outputs から取得
aws logs tail /aws/ecs/LtJawsEcsExpressStack-TaskLogs... \
  --follow --region ap-northeast-1
```

---

## ⚙️ Stack のカスタマイズ

`bin/ecs-app.ts` で `EcsAppStackProps` を介して以下を変更可能:

| プロパティ | デフォルト | 説明 |
|---|---|---|
| `cpu` | `'256'` | Fargate CPU units(string; ECS Express CFN 仕様)。Lambda 512MB とフェア比較するため最小値 |
| `memory` | `'512'` | Fargate メモリ MB(string) |
| `containerPort` | `8080` | Hono が listen するポート。server.ts の `PORT` 環境変数として注入される |
| `healthCheckPath` | `'/health'` | ALB ヘルスチェック先(Express デフォルトは `HTTP:80/ping` なので必ず上書き) |
| `serviceName` | `'lt-jaws-ecs'` | URL = `https://<serviceName>.ecs.<region>.on.aws/`。これ変えると URL も変わる |
| `scalingTarget` | `{ min: 1, max: 1 }` | LT 用なので 1 固定。本番なら `{ min: 2, max: 10 }` 等 |
| `logRetention` | `RetentionDays.ONE_WEEK` | CloudWatch Logs 保持期間 |

例:

```typescript
new EcsAppStack(app, 'LtJawsEcsExpressStack', {
  env: { account: '...', region: 'ap-northeast-1' },
  cpu: '1024',
  memory: '2048',
  scalingTarget: { minTaskCount: 2, maxTaskCount: 10 },
});
```

---

## 📊 既知の挙動・制約

| 観点 | 状況 | LT テーマとの呼応 |
|---|---|---|
| L2 construct 未提供 | `CfnExpressGatewayService` のみ。文字列 ARN を取り回す必要あり | 「**新機能あるある**」ネタ。Issue [#36234](https://github.com/aws/aws-cdk/issues/36234) を引用予定 |
| 共有 ALB | デフォは AWS が同 VPC 内の他 Express サービスと ALB を共有 | 「料金が1サービスあたり ~$0」を実現してる根拠 |
| インフラロール必須 | `ecs.amazonaws.com` を信頼する別ロールを作る必要あり | Lambda には無い概念(Express が自分で ALB 作るので必要) |
| URL が auto-issued | `<serviceName-prefix>-<32hex>.ecs.<region>.on.aws` 形式で AWS が発行 (ドキュメントとは違う) | Lambda Function URL がランダム生成だったのと違って **prefix で識別可能** な点が地味に効く |
| Container Insights v2 | クラスタで `ENABLED`。1$/月程度の追加コスト | 比較ベンチで CPU/メモリ実測値を取れる |
| Native module 非対応 | esbuild bundle なので `better-sqlite3` 等は bundle 不可 | 今回は pure JS のみなので無問題 |

---

## 💸 コスト

LT スライド配信用途、月間 1,000 アクセス想定:

| サービス | 月額 (Tokyo) |
|---|---|
| Fargate (0.25 vCPU / 0.5 GB / 1 task 常時) | 約 $7.2 ($0.04048/vCPU・h × 0.25 × 730h + memory分) |
| ALB (Express 共有なので 1 サービスあたり ~$0) | 約 $0 |
| データ転送 OUT (5.7MB × 1,000) | 約 $0.65 |
| CloudWatch Logs (7日保持) | $0.10 |
| Container Insights v2 | 約 $1 |
| CDK アセット用 S3 / ECR | $0.05 |
| **合計** | **月 $9〜10** |

参考: 前回 Lambda 版 (`cdk-app/`) は月 $1〜2。
**ECS Express 版は約 10 倍** だが、コールドスタートなし・常時応答可・スケール上限自由 などの
メリットがある。LT スライド「金の話で殴る (再演)」でこの差を扱う予定。

---

## 🏷 タグ

すべてのリソースに(Stack タグ経由で)以下のタグが付与される:

| タグ | 値 |
|---|---|
| `Project` | `jaws-ug-lt` |
| `Owner` | `takabo` |
| `Purpose` | `lt-slide-hosting` |
| `PreviousStep` | `lambda+hono (see cdk-app/)` |
| `Runtime` | `ecs-express` |

加えて、**ExpressGatewayService と LogGroup には `Runtime=ecs-express` タグが個別リソースレベルでも明示付与される**。
これは Cost Explorer で Lambda 版とのコスト分離を確実に取るため。
(`@aws-cdk/core:explicitStackTags` フラグ ON では Stack タグが個別リソースの CFN テンプレに乗らないため
個別タグも必要、という cdk-app と同じ事情)

---

## 📅 リポジトリ全体での位置

```
lt-presentation/
├── shared/app.ts            ← Hono アプリ本体(両方の Stack が同一引数で呼ぶ)
├── cdk-app/                 ← Lambda + Function URL 版 (前回 LT)
│   └── … 月額 $1〜2
└── ecs-app/                 ← ECS Express Mode 版 (今回 LT) ← このプロジェクト
    └── … 月額 $9〜10
```

LT で出す比較項目:

| 比較軸 | Lambda (cdk-app) | ECS Express (ecs-app) |
|---|---|---|
| **CDK コード行数 (bin + lib)** | ~280 行 | ~280 行 |
| **CFN リソース数 (核)** | Function / Url / Permission / Role / Policy / LogGroup = 6 | ExpressService / 2 Role / LogGroup / VPC / Subnet×2 / IGW / RT×2 / SG = 多め(VPC 込みなので) |
| **URL の形** | 完全ランダム(`gxyrfra7u7zs...`) | prefix + hash(`lt-16808a31...`) — 2-pass デプロイは両者必要 |
| **コールドスタート** | 数百 ms | なし(常時 1 タスク) |
| **月額 (1k req/月)** | $1〜2 | $9〜10 |
| **同時実行モデル** | 関数同時 1 / インスタンス | Hono が複数リクエスト並列処理 |

→ どちらが「良い/悪い」ではなく、**何にどっちを使うか** が LT の核心メッセージ。

---

## 📄 ライセンス

MIT License

---

## 🔗 関連リンク

- 📺 [公開 URL (deploy 後)](https://lt-jaws-ecs.ecs.ap-northeast-1.on.aws/)
- 📅 [LT イベント (JAWS-UG 静岡)](https://jawsug-shizuoka.connpass.com/)
- 🔥 [Hono 公式](https://hono.dev/)
- 🔧 [@hono/node-server](https://github.com/honojs/node-server)
- 🚀 [Amazon ECS Express Mode 公式アナウンス](https://aws.amazon.com/blogs/aws/build-production-ready-applications-without-infrastructure-complexity-using-amazon-ecs-express-mode/)
- 🐳 [ECS Express Mode 開発者ガイド](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html)
- 🛠 [aws-cdk Issue #36234 — `ExpressGatewayService` L2 要望](https://github.com/aws/aws-cdk/issues/36234)
- 🔑 [Infrastructure IAM Role for Express Gateway Services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/infrastructure_IAM_role.html)
- 📚 [Lambda 版 (`cdk-app/README.md`)](../cdk-app/README.md)
