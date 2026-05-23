# static-app — LT スライド配信スタック (S3 + CloudFront, 現在稼働)

JAWS-UG LT 2 連作 「お前の Lambda それ API サーバーちゃうで」 + 「机上の比較から、実地の検証へ」 のスライド一式を、
**S3 + CloudFront** で静的配信する CDK プロジェクト。

> ✅ **これが LT 自身が主張した "正解" 構成です。**
>
> Part I LT は「Lambda を Web/API サーバーに使うな」 と説き、
> Part II LT は「常時ウォームな用途には ECS Express、 静的配信なら S3+CloudFront 一発が正解」 と
> 補強した。 当日はメタな自己ツッコミで Lambda (`cdk-app/`) + ECS Express (`ecs-app/`) で配信していたが、
> LT 後の archive 用には **本来の "正解" 構成** に着地させた、 そのスタックがこれ。

公開 URL: **https://d1dhu2qos3a4zj.cloudfront.net/**

---

## 🏗 構成

```
                  ┌────────────────────┐
                  │   Browser / SNS    │
                  └─────────┬──────────┘
                            │ HTTPS (auto SSL/TLS, 全世界 CDN)
                            ▼
                  ┌──────────────────────────────────────────┐
                  │  Amazon CloudFront                       │
                  │  - PriceClass: PRICE_CLASS_200 (Tokyo含) │
                  │  - DefaultRootObject: index.html (PartII)│
                  │  - 404 → index.html フォールバック        │
                  │  - Cache: 1h default, 30 days max       │
                  │  - Origin Access Control (OAC)          │
                  └─────────┬────────────────────────────────┘
                            │ S3 REST endpoint (OAC で署名)
                            ▼
                  ┌──────────────────────────────────────────┐
                  │  Amazon S3 (Private bucket)              │
                  │  - BlockPublicAccess: BLOCK_ALL          │
                  │  - EnforceSSL                            │
                  │  - 中身: pre-rendered HTML + assets      │
                  │    - index.html      (Part II)           │
                  │    - lambda.html     (Part I)            │
                  │    - self-intro.html (登壇者プロフ)        │
                  │    - icon.jpg / ogp.jpg / ogp-ecs.jpg    │
                  │    - audio/slide_*.mp3 (Part I)          │
                  │    - audio-ecs/slide_*.mp3 (Part II)     │
                  └──────────────────────────────────────────┘
```

### 採用しなかった選択肢

| 選択肢 | 採用しなかった理由 |
|---|---|
| **Lambda + Function URL** (cdk-app/) | LT のメタネタで使ったが、 静的配信には過剰 |
| **ECS Express Mode** (ecs-app/) | LT で実測検証した上で、 静的配信には常駐コストが無駄 |
| **S3 website hosting 単体** (CF なし) | HTTPS 提供されないので不可 |
| **CloudFront + S3 with public bucket** | OAC を使えば private のまま安全に配信できる |
| **カスタムドメイン (ACM 証明書)** | LT archive 用途では CloudFront 標準ドメインで十分 |

---

## 📂 ディレクトリ構成

```
static-app/
├── README.md                  ← このファイル
├── package.json               (CDK + ts-node)
├── tsconfig.json
├── cdk.json                   ( app: ts-node bin/static-app.ts )
├── .gitignore / .npmignore
│
├── bin/
│   └── static-app.ts          ← CDK エントリ (account/region は Tokyo ハードコード)
│
├── lib/
│   └── static-app-stack.ts    ← Stack: S3 (Private+OAC) + CloudFront + BucketDeployment
│
├── scripts/
│   └── build-static.mjs       ← HTML pre-render (shared/app.ts の OGP ロジックを移植)
│
└── dist/                      ← npm run build:html の出力 (gitignore 済)
    ├── index.html             ← Part II (root → これが /)
    ├── lambda.html            ← Part I (/lambda.html)
    ├── self-intro.html        ← /self-intro.html
    ├── icon.jpg / ogp.jpg / ogp-ecs.jpg
    ├── audio/slide_*.mp3
    └── audio-ecs/slide_*.mp3
```

---

## 🚀 デプロイ

### 前提

- Node.js 20.x 以上
- AWS CLI v2 認証設定済み (account `xxxxxxxxxxxx` / `ap-northeast-1` を想定)
- CDK Bootstrap 済 (`cdk-app/` で済んでるなら再実行不要)

### 初回 / 通常デプロイ

```bash
# 依存
npm install

# 静的アセット (pre-render HTML + コピー) → dist/
npm run build:html

# CDK deploy (S3 + CF 作成 + BucketDeployment)
npx cdk deploy
```

成功すると以下のような Outputs:

```
Outputs:
LtJawsStaticStack.StaticUrl = https://d1dhu2qos3a4zj.cloudfront.net/
LtJawsStaticStack.DistributionId = E3CMH7I19I40AS
LtJawsStaticStack.BucketName = ltjawsstaticstack-assetbucket1d025086-...
```

### 2-pass OGP (初回のみ)

CloudFront URL は初回 deploy 後にしか確定しないので、 **2 回 deploy する**:

```bash
# 1 回目: PUBLIC_URL 空でビルド → deploy → CF URL を Outputs から取得
npm run build:html && npx cdk deploy
# → StaticUrl = https://dxxxxx.cloudfront.net/

# 2 回目: 確定した URL を環境変数で渡してビルド → 再 deploy で OGP 完成
LT_STATIC_PUBLIC_URL=https://dxxxxx.cloudfront.net node scripts/build-static.mjs
npx cdk deploy
```

`LT_STATIC_PUBLIC_URL` は `.env` に書いてもよい (`python-dotenv` 系は使わないが、 shell でファイル source すれば反映)。

### 内容を更新したら

スライド HTML を編集したり、 新しい音声を追加したりした後:

```bash
npm run build:html  # dist/ を再生成
npx cdk deploy      # S3 upload + CloudFront invalidation (全パス)
```

BucketDeployment が `distributionPaths: ['/*']` で全パス invalidate するので、 即時 CF に反映。

### 削除

```bash
npx cdk destroy
```

S3 bucket は `autoDeleteObjects: true` + `removalPolicy: DESTROY` なので、 中身ごと消える。

---

## ⚙️ Stack のカスタマイズ

`bin/static-app.ts` で `StaticAppStackProps` を介して以下を変更可能:

| プロパティ | デフォルト | 説明 |
|---|---|---|
| `distDir` | `'../dist'` | アップロードする静的アセットの src |
| `defaultTtl` | `Duration.hours(1)` | CloudFront キャッシュ TTL |

---

## 💰 月額コスト

LT アーカイブ用途 (月 1,000 アクセス、 ~13 MB):

| サービス | 月額 |
|---|---|
| S3 storage (~13 MB) | < $0.001 |
| CloudFront データ転送 (~13 MB × 1,000) | ~$0.002 |
| CloudFront リクエスト | ~$0.001 |
| **合計** | **約 $0.01/月** |

参考:
- LT 当日 Lambda 版: 月 $1〜2
- LT 当日 ECS Express 版: 月 $17〜20

**1/100〜1/2000 までコスト圧縮** された。 LT 自身が主張した 「静的なら正解構成」 の威力。

---

## 🏷 タグ

| タグ | 値 |
|---|---|
| `Project` | `jaws-ug-lt` |
| `Owner` | `takabo` |
| `Purpose` | `lt-slide-hosting` |
| `PreviousStep` | `lambda-cdk-app+ecs-app` |
| `Runtime` | `s3-cloudfront` |

---

## 🔗 関連

- 📺 [公開 URL](https://d1dhu2qos3a4zj.cloudfront.net/)
- 📜 [Part I LT (Lambda 版) のコード履歴](../cdk-app/) — destroy 済、 アンチパターン参照用
- 📜 [Part II LT (ECS Express 版) のコード履歴](../ecs-app/) — destroy 済、 実測検証履歴
- 📚 [親 README](../README.md)
