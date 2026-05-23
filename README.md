# お前の Lambda、それ API サーバーちゃうで / 机上の比較から、実地の検証へ

> JAWS-UG 静岡 LT 2 連作の発表資料一式と、その配信インフラ(の歴史)。
>
> | | 内容 | 配信構成 |
> |---|---|---|
> | **Part I** (2026-04-25 登壇) | 「お前の Lambda、それ API サーバーちゃうで」 | LT 当日 = Lambda + Hono + CDK (**意図的にアンチパターン**) |
> | **Part II** (2026-05-22 登壇) | 「机上の比較から、実地の検証へ — ECS Express 移行レポート」 | LT 当日 = ECS Express Mode + Fargate + 共有 ALB |
> | **アフター** (2026-05-23〜) | LT が主張した **正解構成へ着地** | **S3 + CloudFront** (現在の唯一の生きてる配信先) |
>
> **アプリ層は完全に同一** (`shared/app.ts` の Hono アプリ) のまま、
> LT 当日は インフラ層だけを Lambda / ECS Express で差し替え並走、 LT 後は両方とも `cdk destroy` して
> 静的配信 (S3+CF) に着地。 つまり LT 自身が主張した 「**静的なら S3+CloudFront 一発が正解**」 を、
> アーカイブ状態でも体現した形になっている。

🌐 **現在の公開URL (S3+CloudFront)**: https://d1dhu2qos3a4zj.cloudfront.net/
📅 **イベント**: [JAWS-UG 静岡 #36](https://jawsug-shizuoka.connpass.com/event/385497/)
🎤 **発表者**: [@takabo12786375](https://x.com/takabo12786375) / GLOCALS

> 📜 **歴史的 URL (LT 当日のみ稼働、 現在は 404)**:
> - ~~Part I (Lambda 版): `gxyrfra7u7zs7bz3g6abbkshye0zjynp.lambda-url.ap-northeast-1.on.aws`~~
> - ~~Part II (ECS Express 版): `lt-16808a3125334d3f993982859eaf40f6.ecs.ap-northeast-1.on.aws`~~

---

## 🎯 LT の主張

| | |
|---|---|
| **何を言いたいか** | Lambda は**イベントハンドラー**であって **API サーバーではない** |
| **誰に言いたいか** | Express / NestJS / Hono を Lambda に載せて API Gateway 経由で API 配信している人 |
| **じゃあ何使うか** | **Cloud Run**（制約なし、ゼロスケール対応）or **ECS Express Mode**（AWS 縛り、2025年11月発表の Cloud Run 対抗） |
| **キーメッセージ** | 1 つの技術で全部やるな。**ハイブリッドが正解**。BFF→Vercel / API→Cloud Run or ECS Express / イベント→Lambda / DB直結→Edge Functions |

スライド全 10 枚、音声ガイド付き。約 5 分の LT。

---

## 🧨 メタな構造（このリポジトリの最大のネタ）

```
[ Part I 主張 ]      Lambda は API サーバーちゃう
       ↓
[ Part I 配信 ]      この LT 資料を Lambda + Hono で配信(意図的にアンチパターン)
       ↓
[ Part I 構成 ]      CDK + TypeScript で IaC 化(過剰設計の見本)
       ↓
[ Part II 検証 ]     同じ Hono アプリ(shared/app.ts)を ECS Express Mode に載せ替えて実測
       ↓
[ Part II 結論 ]     sustained RPS x1.4, 中央値 -40%、 ただし P99 は意外にも Lambda が勝つ
                    → 静的配信に限れば差は微妙、 違うのは I/O バウンドな API の局面
       ↓
[ アフター (今) ]    両 stack `cdk destroy` → **S3 + CloudFront** に着地
                    → LT 自身が主張した 「静的なら正解構成」 を、 アーカイブでも体現
                    → 月額 $19〜21 → $0.10 へ
```

「やりがちなアンチパターンを意図的に踏み抜いて、**次回(Part II)の比較対象に自分自身を使う**」というセルフ実演。
Part I の最終スライドで予告した「机上の比較から、実地の検証へ」を、本リポジトリの ecs-app/ で完結させた。

---

## 📁 ディレクトリ構成

```
lt-presentation/
├── README.md                                ← このファイル
├── package.json                             ← root deps (hono, @hono/node-server)
├── .dockerignore                            ← Docker build context 除外(ecs-app の bundle 用)
│
├── lt-jaws-audio-prerecorded-final2.html    ← Part I スライド (HTML 単体、10 枚分)
├── lt-jaws-ecs-migration.html               ← Part II スライド (HTML 単体、10 枚分)
│                                              - 共に SVG/CSS で全スライド描画 + <audio> 自動進行
│                                              - 操作: Space / ← → / F / R / Esc
│                                              - OGP/Twitter Card は実行時に shared/app.ts が注入
│
├── icon.jpg                                 ← 発表者アイコン
├── ogp.jpg                                  ← Part I SNS シェア用 OGP 画像 (1200×630)
├── ogp-ecs.jpg                              ← Part II SNS シェア用 OGP 画像 (1280×720, slide 1 のスクショ)
├── self-intro.html                          ← 自己紹介ページ (LT 中に別タブで表示用)
│
├── audio/slide_1.mp3 〜 slide_10.mp3         ← Part I の TTS 音声 (speed=1.05)
├── audio-ecs/slide_1.mp3 〜 slide_11.mp3    ← Part II の TTS 音声 (speed=1.5, 全 11 枚)
│
├── generate_audio_final2.py                 ← Part I 用 音声生成スクリプト
├── generate_audio_ecs.py                    ← Part II 用 音声生成スクリプト
│                                              - OpenAI TTS (gpt-4o-mini-tts) / voice=onyx
│                                              - 関西弁寄り原稿を内蔵
│
├── .env.example                             ← OPENAI_API_KEY のテンプレ。 cp して `.env` 作って使う
├── .env                                     ← 実キー (gitignore 済)
│
├── shared/
│   └── app.ts                               ← Hono アプリ本体 (Lambda / ECS Express で **同一**)
│                                              - createApp({ publicDir, publicUrl, runtime }) を export
│                                              - / /ecs /lambda /audio/:f /audio-ecs/:f /health
│
├── cdk-app/                                 ← [ARCHIVED] Lambda + Function URL 配信スタック (Part I)
│   ├── …                                    LT 当日のみ稼働、 2026-05-23 に `cdk destroy` 済。
│   └── README.md                            コード/IaC は履歴として残してある。
│
├── ecs-app/                                 ← [ARCHIVED] ECS Express Mode 配信スタック (Part II)
│   ├── …                                    LT 当日のみ稼働、 2026-05-23 に `cdk destroy` 済。
│   └── README.md                            同上。
│
├── static-app/                              ← [ACTIVE] S3 + CloudFront 配信 (LT 後の "正解" 構成)
│   ├── bin/static-app.ts                    ← CDK エントリ
│   ├── lib/static-app-stack.ts              ← Stack (S3 + CloudFront + OAC + BucketDeployment)
│   ├── scripts/build-static.mjs             ← HTML pre-render + OGP 注入 + assets コピー → dist/
│   ├── dist/                                ← ビルド出力 (gitignore 済)
│   └── README.md
│
└── benchmarks/
    └── results.json                         ← Part II の核 (oha 30s×c50 GET /health)
                                              - Lambda: RPS 1907, P50 25ms, P99 38ms
                                              - ECS  : RPS 2734, P50 15ms, P99 75ms
```

---

## 🛠 技術スタック

| 層 | 技術 | 役割 |
|---|---|---|
| **スライド** | HTML / CSS / Vanilla JS | 自前実装、フレームワーク不使用。Part I = amber アクセント、Part II = cyan |
| **音声生成** | OpenAI TTS (`gpt-4o-mini-tts`) | 関西弁寄り原稿を `onyx` ボイスで読み上げ |
| **API フレームワーク** | [Hono](https://hono.dev/) v4 | `shared/app.ts` 1 本で Lambda / ECS 両方ホスト |
| **Part I ランタイム** | AWS Lambda (Node.js 20.x) + Function URL | 静的ファイル配信に **意図的にアンチパターン** |
| **Part II ランタイム** | AWS Fargate + ECS Express Mode + 共有 ALB | Part I が批判した「ちゃんとした」構成 |
| **コンテナ** | `node:20-slim` + esbuild bundle (server.js 1 ファイル化) | runtime stage ~85MB |
| **IaC** | AWS CDK v2 (TypeScript) | `cdk-app/` (Lambda 版) と `ecs-app/` (ECS 版) を別 Stack |
| **CDK 構造** | Lambda は `NodejsFunction` (L2 高機能)、ECS は `CfnExpressGatewayService` (L1 のみ) | L2 未提供は LT で扱う |
| **負荷テスト** | [oha](https://github.com/hatoo/oha) v1.14.0 | 並列50, 30 秒, GET /health |
| **リージョン** | `ap-northeast-1` (Tokyo) | LT 会場の静岡から物理的に近い |

---

## 🚀 Quick Start

### 必要なもの

- Node.js 20.x 以上
- Python 3.10+ （音声生成のため）
- AWS CLI v2 + 認証設定済み
- OpenAI API キー（音声再生成する場合）

### 1. 音声を生成する(再生成する場合のみ)

```bash
# OpenAI Python SDK
pip install openai --break-system-packages

# API キー設定
export OPENAI_API_KEY="sk-..."

# Part I (全 10 スライド、約 30 秒、$0.05 程度)
python generate_audio_final2.py        # → audio/slide_1.mp3 〜 slide_10.mp3

# Part II (全 10 スライド、約 30 秒、$0.05 程度)
python generate_audio_ecs.py           # → audio-ecs/slide_1.mp3 〜 slide_10.mp3
```

### 2. ローカルで動作確認(静的サーバー)

```bash
# Part I 単体
python -m http.server 8000
open http://localhost:8000/lt-jaws-audio-prerecorded-final2.html

# Part II 単体
open http://localhost:8000/lt-jaws-ecs-migration.html
```

スライドが表示されたら **Space キー** で自動再生スタート。

### 3. ローカルで動作確認(shared/app.ts 経由、 Hono で配信)

```bash
# root deps + ecs-app deps
npm install
( cd ecs-app && npm install )

# Docker で実行(リポジトリルートを context にビルド)
docker build -f ecs-app/runtime/Dockerfile -t lt-jaws-ecs:dev .
docker run --rm -p 8080:8080 -e PUBLIC_URL=http://localhost:8080 lt-jaws-ecs:dev

# 別ターミナルで疎通
curl -s http://localhost:8080/health | jq
open http://localhost:8080/         # Part I
open http://localhost:8080/ecs      # Part II
```

### 4. AWS にデプロイ

#### 4-A. 現在の "正解" 構成 — S3 + CloudFront (推奨、 月 $0.01)

```bash
# 初回のみ: CDK Bootstrap (アカウント × リージョンごとに 1 回)
( cd static-app && npx cdk bootstrap )

# Pre-render HTML (OGP 注入) + S3 upload + CloudFront 作成
( cd static-app && npm install && npm run build:html && npx cdk deploy )
# → Outputs.StaticUrl = https://dxxxxx.cloudfront.net/
# 1 回目は OGP URL 空のまま → URL 確定後に LT_STATIC_PUBLIC_URL を入れて再 deploy:
( cd static-app && LT_STATIC_PUBLIC_URL=https://dxxxxx.cloudfront.net node scripts/build-static.mjs && npx cdk deploy )
```

#### 4-B. [ARCHIVED] LT 当日の "意図的アンチパターン" 構成

> ⚠️ 2026-05-23 に両 stack `cdk destroy` 済。 LT で 「Lambda は API サーバーちゃう」 「ECS Express で実地検証」 をやるためだけに使った、 LT 当日限定のメタ配信。 コード/IaC はリポジトリに残してあるので、 もう一度デプロイしたければ走らせられる。

```bash
# Part I: Lambda + Function URL ("やってはいけない例" として残してある)
( cd cdk-app && npm install && npx cdk deploy )
# → Outputs.LtUrl = https://xxxxxxxx.lambda-url.ap-northeast-1.on.aws/

# Part II: ECS Express + 自動 ALB (Docker daemon が要る)
( cd ecs-app && npm install && npx cdk deploy )
# → Outputs.EcsUrl = https://<prefix>-<32hex>.ecs.ap-northeast-1.on.aws/
```

詳細は [`cdk-app/README.md`](cdk-app/README.md) (Part I) と [`ecs-app/README.md`](ecs-app/README.md) (Part II)。

---

## 🎨 スライドについて

### 操作

| キー | 動作 |
|---|---|
| `Space` | 音声付き自動再生 / 一時停止 |
| `→` | 次のスライドへ |
| `←` | 前のスライドへ |
| `F` | フルスクリーン切り替え |
| `R` | 最初に戻る |
| `Esc` | 再生停止 |

### Part I 構成 — 「お前の Lambda それ API サーバーちゃうで」

| # | タイトル | 役割 |
|---|---|---|
| 01 | お前の Lambda それ API サーバーちゃうで | タイトル |
| 02 | はじめに、お断り | 免責(AI に書かせた告白) |
| 03 | まず白状する | 自己告白で聴衆と距離を詰める |
| 04 | Lambda が悲鳴あげてた | 痛みポイント 6 つ |
| 05 | Lambda の本当の居場所 | 適切な用途 vs 不適な用途 |
| 06 | 数字で殴る | カタログスペック比較 |
| 07 | 金の話で殴る | コスト比較 |
| 08 | 待望の Cloud Run 対抗 | ECS Express Mode 紹介 |
| 09 | 2026 年の処方箋 | まとめ |
| 10 | 載せ替えませんか? | Part II 予告 |

### Part II 構成 — 「机上の比較から、実地の検証へ」

| # | タイトル | 役割 |
|---|---|---|
| 01 | 机上の比較から、実地の検証へ | タイトル |
| 02 | 前回 LT のおさらい | "Lambda は API サーバーちゃう" の再掲 |
| 03 | 移行の方針 | アプリは 1 ミリも変えへん、インフラだけ差し替え |
| 04 | ECS Express Mode とは | 必要なん 3 つだけ(image / exec role / infra role) |
| 05 | CDK ナナメ比較 | cdk-app/ vs ecs-app/ |
| 06 | 実測 RPS / P50 / P99 | oha 30s @50 で得た数字 |
| 07 | 実測コスト | $1〜2 vs $9〜10 (1k req/月想定) |
| 08 | 移行体験ログ | 踏み抜いた落とし穴 6 連発 |
| 09 | 2026 年の処方箋 改訂版 | Lambda / ECS / Edge の使い分け |
| 10 | OUTRO | ご清聴 + Q&A 誘い |

---

## 🤖 音声生成について

### なぜ TTS なのか

LT 当日は登壇者本人が話したが、**スライド単体配信時にも音声で内容が伝わる**ようにするため。

スライド資料を SNS でシェアした際、テキストだけでは伝わらないトーン（関西弁の煽り口調、皮肉のニュアンス）を音声で補完する。

### モデルとボイス

```python
MODEL = "gpt-4o-mini-tts"  # 最新・最安・instructions 対応
VOICE = "onyx"              # 深みのある男性声、知的トーン
SPEED = 1.05                # ややテンポ速め
```

### 関西弁寄りの工夫

標準語 TTS でも関西弁っぽく聞こえるよう、原稿側で工夫している：

- 漢字を多めにしてイントネーションのズレを吸収
- 長音記号（「ー」）を控えめに
- 語尾の「や」「で」「ねん」は平仮名で残す
- 句読点で「間」を制御

---

## 💰 運用コスト (フェーズ別)

LT スライド配信、月 1,000 アクセス程度 想定:

### 現在(2026-05-23〜) — S3 + CloudFront

| 項目 | 月額 |
|---|---|
| S3 storage (~13MB) | < $0.001 |
| CloudFront データ転送 (~13MB × 1000) | ~$0.002 |
| CloudFront リクエスト | ~$0.001 |
| **合計** | **月 $0.01 程度** |

### LT 当日 Part I — Lambda + Function URL [`ARCHIVED`]

| 項目 | 月額 |
|---|---|
| Lambda 実行 | $0.00 (無料枠内) |
| Lambda Function URL | $0.00 |
| データ転送 (mp3 含む 5.7MB × 1000) | 約 $0.65 |
| CloudWatch Logs (保持 1 週間) | $0.10 |
| CDK アセット用 S3 | $0.01 |
| **合計** | **月 $1〜2 程度** |

### LT 当日 Part II — ECS Express + Fargate + 共有 ALB [`ARCHIVED`]

| 項目 | 月額 |
|---|---|
| Fargate (0.25 vCPU / 0.5 GB / 1 task 常時) | 約 $7.20 |
| Application Load Balancer (Express 共有なので per-service ~ $0) | 約 $0 |
| データ転送 OUT (5.7MB × 1000) | 約 $0.65 |
| CloudWatch Logs + Container Insights v2 | 約 $9.30 |
| ECR / CDK アセット S3 | 約 $0.05 |
| **合計** | **月 $17〜20 程度** |

実測した結果、当初 Part I で予告した「ECS Express は月 $30〜50」は **過大評価** だった。
共有 ALB のおかげで料金が下がり、 0.25 vCPU 最小構成で十分回るため。 **約 10〜15 倍差** に留まる(LT で扱った数字)。

そして LT 後、 主張通り **S3+CloudFront に着地して 月 $0.01** = Lambda の 1/100、 ECS Express の 1/1700 まで圧縮。

---

## 📚 関連リンク

- 📺 [現在の公開ページ (S3+CloudFront)](https://d1dhu2qos3a4zj.cloudfront.net/)
- 📜 ~~[Part I 公開ページ (Lambda 版, 当日のみ)](https://gxyrfra7u7zs7bz3g6abbkshye0zjynp.lambda-url.ap-northeast-1.on.aws/)~~ — destroyed
- 📜 ~~[Part II 公開ページ (ECS Express 版, 当日のみ)](https://lt-16808a3125334d3f993982859eaf40f6.ecs.ap-northeast-1.on.aws/)~~ — destroyed
- 📅 [JAWS-UG 静岡 #36(connpass)](https://jawsug-shizuoka.connpass.com/event/385497/)
- 🐳 [Amazon ECS Express Mode 公式アナウンス](https://aws.amazon.com/about-aws/whats-new/2025/11/announcing-amazon-ecs-express-mode/)
- 📚 [Amazon ECS Express Mode 開発者ガイド](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html)
- 🛠 [aws-cdk Issue #36234 — `ExpressGatewayService` L2 要望](https://github.com/aws/aws-cdk/issues/36234)
- 🔥 [Hono](https://hono.dev/) / [@hono/node-server](https://github.com/honojs/node-server)
- 🛠 [AWS CDK 公式](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- ⚡ [oha](https://github.com/hatoo/oha) — Rust 製の HTTP 負荷テストツール

---

## 📊 実測ベンチマーク (Part II の核)

`oha -z 30s -c 50 GET /health` (Tokyo origin → Tokyo target):

| 指標 | Part I (Lambda) | Part II (ECS Express) | 勝者 |
|---|---:|---:|---|
| RPS | 1,907 | **2,734** | ECS (×1.43) |
| P50 | 25 ms | **15 ms** | ECS |
| P90 | 30 ms | **25 ms** | ECS |
| P95 | 32 ms | **31 ms** | ECS (微差) |
| P99 | **38 ms** | 75 ms | Lambda (意外) |
| P99.9 | **127 ms** | 198 ms | Lambda |
| 1st request (cold) | 821 ms | 230 ms (TLS+DNS only) | ECS |

→ **Lambda の P99 勝ちは事前予想と逆**。 warm 状態で sustained burst を受けると、 Lambda が fan-out して並列処理する分テールが締まる。
ECS は 1 タスクが全リクエストを抱えるので tail が伸びる。 詳細は [`benchmarks/results.json`](benchmarks/results.json)。

---

## 📄 ライセンス

MIT License

スライド本文は CC BY 4.0 で再利用可。引用時は @takabo12786375 へクレジット明示を歓迎。

---

## 🙏 謝辞

- スライド構成・コード生成：Claude (Anthropic) との共作
- イベント運営：JAWS-UG 静岡 支部の皆様
- TTS：OpenAI

---

> _このプロジェクトは、自分の主張を自分で実証してから否定する、という形でメタな対話を試みています。_  
> _次回もぜひ JAWS-UG でお会いしましょう。_
