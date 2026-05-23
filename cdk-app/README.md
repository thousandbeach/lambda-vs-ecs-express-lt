# cdk-app — [ARCHIVED] LT 当日 Lambda 配信スタック

> 📜 **このスタックは 2026-05-23 に `cdk destroy` 済です**。 LT 当日のみ稼働。
> 現在の配信は [`../static-app/`](../static-app/) (S3+CloudFront) に移行。
> このディレクトリの IaC / コードは LT のメタネタ (「Lambda を意図的にアンチパターンで使う」)
> の **履歴的参照** として残してあります。

JAWS-UG LT「お前の Lambda それ API サーバーちゃうで」のスライド一式を、  
**Lambda + Hono + Function URL** で配信するための AWS CDK プロジェクト。

> ⚠️ **これは意図的なアンチパターンです。**
> 本来、静的ファイル配信は S3 + CloudFront が AWS の正攻法。
> Lambda を Web サーバーとして使うことを LT 内で批判している登壇者本人が、
> その主張への自己ツッコミとして敢えて Lambda 配信構成を採用しました(LT 当日のみ)。
> 詳しくは [親 README](../README.md) を参照。

> 💡 **再デプロイしたい場合**: 通常通り `npm install && npx cdk deploy`。
> ただし現状は static-app が正規。 「アンチパターン再演」 が目的のときだけ。

---

## 🏗 構成

```
                     ┌──────────────────┐
                     │   Browser / SNS  │
                     └────────┬─────────┘
                              │ HTTPS
                              ▼
                ┌─────────────────────────┐
                │  Lambda Function URL    │  認証なし、CORS デフォルト
                │  (HTTPS endpoint)       │
                └────────┬────────────────┘
                         │ invoke
                         ▼
        ┌────────────────────────────────────┐
        │  Lambda Function (Node.js 20.x)    │
        │  ┌──────────────────────────────┐  │
        │  │  Hono (aws-lambda adapter)   │  │
        │  │                              │  │
        │  │  GET /            → HTML     │  │
        │  │  GET /icon.jpg    → 画像     │  │
        │  │  GET /ogp.jpg     → OGP画像  │  │
        │  │  GET /audio/:f    → mp3      │  │
        │  │  GET /health      → JSON     │  │
        │  └──────────────────────────────┘  │
        │                                    │
        │  /var/task/public/                 │
        │  ├── index.html  (44 KB)           │
        │  ├── icon.jpg    (27 KB)           │
        │  ├── ogp.jpg     (77 KB)           │
        │  └── audio/                        │
        │      ├── slide_1.mp3 〜 slide_10.mp3│
        │      (合計 約 5.6 MB)               │
        └────────────────────────────────────┘
                         │ logs
                         ▼
            ┌──────────────────────────┐
            │  CloudWatch Logs (7日)   │
            └──────────────────────────┘
```

### 採用しなかった選択肢（と、その理由）

| 選択肢 | 採用しなかった理由 |
|---|---|
| **S3 + CloudFront** | 正攻法すぎてメタネタにならない |
| **API Gateway + Lambda** | Function URL で十分、API GW 挟むのも過剰 |
| **CloudFront + Lambda Function URL** | OAC 設定で過剰設計が増えるが、コスト対効果が薄い |
| **Lambda Web Adapter** | Hono は Lambda 純正対応してるので不要 |

---

## 📂 ディレクトリ構成

```
cdk-app/
├── README.md                  ← このファイル
├── package.json
├── tsconfig.json
├── cdk.json
│
├── bin/
│   └── cdk-app.ts             ← CDK エントリポイント
│                                 - 東京リージョン明示
│                                 - タグ付け（次回移行のメモ含む）
│
├── lib/
│   └── cdk-app-stack.ts       ← Stack 定義本体
│                                 - NodejsFunction (esbuild バンドル)
│                                 - bundling.commandHooks で静的ファイル同梱
│                                 - Function URL（認証なし）
│                                 - CloudWatch Logs（7日保持）
│
├── lambda/
│   ├── index.ts               ← Hono ハンドラ
│   │                            - 静的ファイル配信ロジック
│   │                            - パストラバーサル対策あり
│   │                            - mp3 ファイル名のホワイトリスト検証
│   │
│   └── public/                ← Lambda パッケージに同梱される静的ファイル
│       ├── index.html         ← LT スライド本体（OGP メタタグ込み）
│       ├── icon.jpg           ← 発表者アイコン
│       ├── ogp.jpg            ← SNS シェア用 OGP 画像（1200×630）
│       └── audio/
│           ├── slide_1.mp3
│           └── ... slide_10.mp3
│
└── cdk.out/                   ← cdk synth の出力（自動生成、gitignore対象）
```

---

## 🚀 デプロイ

### 前提

- Node.js 20.x 以上 / npm 10.x 以上
- AWS CLI v2 認証設定済み
- CDK v2 (`npm install -g aws-cdk` または `npx cdk`)
- 必要 IAM 権限: CloudFormation, IAM, Lambda, Logs, S3 の作成・更新

### 初回セットアップ

```bash
# 依存パッケージ
npm install

# 東京リージョンで CDK Bootstrap（初回のみ、アカウント x リージョンごと）
export AWS_REGION=ap-northeast-1
export AWS_DEFAULT_REGION=ap-northeast-1
npx cdk bootstrap
```

### デプロイ

```bash
# TypeScript ビルド
npm run build

# 変更内容を確認（任意）
npx cdk diff

# デプロイ実行
npx cdk deploy

# IAM 関連の差分がないなら自動承認も可
npx cdk deploy --require-approval never
```

成功すると以下が出力される：

```
Outputs:
LtJawsLambdaStack.LtUrl = https://xxxxx.lambda-url.ap-northeast-1.on.aws/
LtJawsLambdaStack.LtHandlerName = LtJawsLambdaStack-LtHandler...
```

`LtUrl` がスライド公開 URL。

### 静的ファイルだけ更新したい場合

`lambda/public/` 配下のファイル（HTML/mp3/画像）を変更した後：

```bash
npm run build
npx cdk deploy --require-approval never
```

esbuild がコードを再バンドルし、静的ファイルも再同梱されて Lambda が更新される。  
**Function URL は不変**（CloudFormation のインプレース更新のため）。

### 削除

```bash
npx cdk destroy
```

⚠️ destroy 後に再 deploy すると Function URL が変わる可能性がある。

---

## 🔧 開発

### ローカル動作確認

Lambda 内のコードをローカルで実行する場合は、`lambda/index.ts` を Hono の他のアダプタ（例: `@hono/node-server`）に差し替えて起動する。  
ただし、デプロイ時とのギャップを生むので、本プロジェクトでは **CDK deploy で都度確認** する方針。

### TypeScript ビルド

```bash
npm run build
# tsc が実行される。エラーがなければ何も出力しない。
```

### CloudFormation テンプレートの確認

```bash
npx cdk synth
# cdk.out/LtJawsLambdaStack.template.json に出力される
```

### ログ確認

```bash
# 関数名は cdk deploy の Outputs から取得
aws logs tail /aws/lambda/LtJawsLambdaStack-LtHandler... \
  --follow --region ap-northeast-1
```

---

## ⚙️ Stack のカスタマイズ

`bin/cdk-app.ts` で `CdkAppStackProps` を介して以下を変更可能：

| プロパティ | デフォルト | 説明 |
|---|---|---|
| `lambdaMemorySize` | `512` (MB) | Lambda メモリサイズ |
| `lambdaTimeout` | `Duration.seconds(10)` | Lambda 最大実行時間 |
| `logRetention` | `RetentionDays.ONE_WEEK` | CloudWatch Logs 保持期間 |

例：

```typescript
new CdkAppStack(app, 'LtJawsLambdaStack', {
  env: { account: '...', region: 'ap-northeast-1' },
  lambdaMemorySize: 1024,
  lambdaTimeout: cdk.Duration.seconds(30),
  logRetention: logs.RetentionDays.ONE_MONTH,
});
```

---

## 📊 既知の挙動・制約

### Lambda の制約と、それが LT テーマを実証している事実

| 制約 | 今回の構成での状況 | LT テーマとの呼応 |
|---|---|---|
| Lambda 応答上限 6 MB（buffered） | 最大 mp3 が 1 MB なので問題なし | スライド5「数字で殴る」で言及 |
| パッケージサイズ 250 MB | 静的ファイル含めて約 6 MB、余裕 | スライド5「数字で殴る」で言及 |
| 同時実行 1 / インスタンス | 静的配信なら問題ないが、I/O バウンドな API では悲劇 | スライド5の核心メッセージ |
| コールドスタート | 数百 ms 〜 数秒 | スライド3「悲鳴」で言及 |
| INIT フェーズ課金（2025/8〜） | 微小だが、本構成では実体験できる | スライド3「悲鳴」で NEW バッジ付き紹介 |

### deprecation 警告

`logRetention` プロパティは将来 deprecated 予定。  
動作影響はないが、次回リファクタ時に `logGroup` プロパティへ移行予定。

```
[WARNING] aws-cdk-lib.aws_lambda.FunctionOptions#logRetention is deprecated.
  use `logGroup` instead
```

### 「ログ保持期間 7 日」を設定するためだけに Lambda が 1 個増える

CDK が `logRetention` を実装するために、**裏で別の Lambda 関数を作って `PutRetentionPolicy` API を叩く**カスタムリソースを生成する。  
つまり、本 Stack には Lambda 関数が 2 個ある（メインのハンドラ + ログ保持期間管理用カスタムリソース）。

これも「IaC 書いてる時間あったら設計し直せ」感を象徴する事象として、LT 内に組み込み可能なネタ。

---

## 💸 コスト

LT スライド配信用途、月間 1,000 アクセス想定：

| サービス | 月額 |
|---|---|
| Lambda 実行 | $0.00（無料枠内） |
| Lambda Function URL | $0.00 |
| データ転送 OUT（5.7MB × 1,000） | 約 $0.65 |
| CloudWatch Logs（7日保持） | $0.10 |
| CDK アセット用 S3 | $0.01 |
| **合計** | **月 $1〜2** |

次回 ECS Express Mode 版では月 $30〜50 を見込む。  
**LT スライド7「金の話で殴る」で示した表通りの結果**になる予定。

---

## 🏷 タグ

すべてのリソースに以下のタグが付与される：

| タグ | 値 |
|---|---|
| `Project` | `jaws-ug-lt` |
| `Owner` | `takabo` |
| `Purpose` | `lt-slide-hosting` |
| `NextStep` | `migrate-to-ecs-express-mode` |

`NextStep` タグで次回移行を**コードで予告**している。

---

## 📅 次回プロジェクトとの関係

このリポジトリは、次回 LT「**机上の比較から、実地の検証へ**」の**ビフォア状態**として保存される。

予定されている次回プロジェクト：

```
lt-presentation-ecs-express/
├── ecs-app/           ← 同じ Hono コードをコンテナ化
│   ├── Dockerfile
│   └── (cdk-app/ より遥かに少ないファイル数になる予定)
└── benchmarks/        ← Lambda vs ECS Express Mode の実測データ
```

次回 LT では、本リポジトリの CDK コード行数 vs 次回プロジェクトの Dockerfile 行数を比較する予定。

---

## 📄 ライセンス

MIT License

---

## 🔗 関連リンク

- 📺 [公開 URL](https://gxyrfra7u7zs7bz3g6abbkshye0zjynp.lambda-url.ap-northeast-1.on.aws/)
- 📅 [LT イベント (JAWS-UG 静岡)](https://jawsug-shizuoka.connpass.com/event/385497/)
- 🔥 [Hono 公式](https://hono.dev/)
- ☁️ [AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- 📦 [Hono AWS Lambda Adapter](https://hono.dev/docs/getting-started/aws-lambda)
- 🐳 [ECS Express Mode（次回比較対象）](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html)
