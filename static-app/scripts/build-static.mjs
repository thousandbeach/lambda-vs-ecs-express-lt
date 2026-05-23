#!/usr/bin/env node
/**
 * 静的配信用の dist/ をビルドする pre-render スクリプト。
 *
 * 動作:
 *   1. リポジトリルートにある HTML 群 (Part I / Part II / 自己紹介) を読み込み
 *   2. shared/app.ts と同じ buildOgpTags ロジックで OGP メタを注入
 *      (HTML 内の `<!--__OGP__-->` マーカーを置換)
 *   3. dist/ に書き出し + 画像/音声を copy
 *
 * 出力レイアウト:
 *   static-app/dist/
 *   ├── index.html       ← Part II (今回 LT) を root に
 *   ├── lambda.html      ← Part I (前回 LT)
 *   ├── self-intro.html  ← 自己紹介
 *   ├── icon.jpg / ogp.jpg
 *   ├── audio/slide_*.mp3      (前回 LT)
 *   └── audio-ecs/slide_*.mp3  (今回 LT)
 *
 * 使い方:
 *   # 1 回目 (CloudFront URL 未確定): OGP は空 URL でも HTML は表示される
 *   node scripts/build-static.mjs
 *
 *   # 2 回目 (CloudFront URL 確定後): 環境変数で正しい URL を渡して再ビルド
 *   LT_STATIC_PUBLIC_URL=https://d1234.cloudfront.net node scripts/build-static.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DIST = join(__dirname, '..', 'dist');

const PUBLIC_URL = process.env.LT_STATIC_PUBLIC_URL || '';

const OGP_MARKER = '<!--__OGP__-->';

/**
 * shared/app.ts の同名関数を移植。 LT 配信元 URL が変わっても OGP を実行時注入
 * していたが、 静的配信では build 時に確定させる必要があるため Pre-render する。
 */
function buildOgpTags({ pagePath, title, description, imagePath }) {
  const url = `${PUBLIC_URL}${pagePath}`;
  const image = `${PUBLIC_URL}${imagePath}`;
  return [
    '<!-- OGP / Twitter Card (pre-rendered for S3+CloudFront archive) -->',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:site_name" content="JAWS-UG LT by @takabo12786375">',
    '<meta property="og:locale" content="ja_JP">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:site" content="@takabo12786375">',
    '<meta name="twitter:creator" content="@takabo12786375">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<meta name="description" content="${description}">`,
    '<meta name="author" content="@takabo12786375">',
  ].join('\n');
}

function processHtml(srcPath, destPath, ogpArgs) {
  const html = readFileSync(srcPath, 'utf8');
  const ogp = buildOgpTags(ogpArgs);
  if (!html.includes(OGP_MARKER)) {
    console.warn(`  [warn] ${basename(srcPath)}: OGP マーカーが無いのでそのまま出力`);
    writeFileSync(destPath, html);
    return;
  }
  const rendered = html.replace(OGP_MARKER, ogp);
  writeFileSync(destPath, rendered);
  console.log(`  pre-rendered ${basename(srcPath)} → ${basename(destPath)}`);
}

// ── 1. dist/ をクリーン再生成 ───────────────────────────────────
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
mkdirSync(join(DIST, 'audio'), { recursive: true });
mkdirSync(join(DIST, 'audio-ecs'), { recursive: true });

console.log(`Building static dist/ with PUBLIC_URL=${PUBLIC_URL || '(empty)'}`);

// ── 2. HTML を pre-render ───────────────────────────────────────
// Part II (今回 LT) を root index に
processHtml(
  join(REPO_ROOT, 'lt-jaws-ecs-migration.html'),
  join(DIST, 'index.html'),
  {
    pagePath: '/',
    title: '机上の比較から、実地の検証へ — ECS Express 移行レポート',
    description:
      'JAWS-UG LT「お前の Lambda それ API サーバーちゃうで」の続編。' +
      'Lambda + Hono 構成を ECS Express Mode に移し替えて、' +
      '実測 RPS / P99 / コスト / コード行数を比較。',
    imagePath: '/ogp-ecs.jpg', // Part II 専用 OGP (slide 1 を chrome headless で撮ったもの)
  },
);

// Part I (前回 LT) を /lambda.html に
processHtml(
  join(REPO_ROOT, 'lt-jaws-audio-prerecorded-final2.html'),
  join(DIST, 'lambda.html'),
  {
    pagePath: '/lambda.html',
    title: 'お前の Lambda それ API サーバーちゃうで',
    description:
      'JAWS-UG 静岡 LT 資料。Lambda を本業に戻す、2026年の設計論。' +
      '― そして、この資料自体も Lambda + Hono で配信されていました(意図的に、 LT 当日のみ)。',
    imagePath: '/ogp.jpg',
  },
);

// 自己紹介 (OGP マーカー入りなので processHtml で OGP 注入)
const selfIntroPath = join(REPO_ROOT, 'self-intro.html');
if (existsSync(selfIntroPath)) {
  processHtml(selfIntroPath, join(DIST, 'self-intro.html'), {
    pagePath: '/self-intro.html',
    title: 'About me — たかぼー / GLOCALS',
    description:
      'JAWS-UG 静岡 LT 登壇者 たかぼー の自己紹介。 ' +
      'MBA + マーケティング が先、 エンジニアリングは後追い。 ' +
      '医療系事業会社のクリエイティブ部門責任者 + フリーランス + 顧問先の問題解決。',
    imagePath: '/ogp-intro.jpg', // 自己紹介専用 OGP (header カードを chrome headless で 1200×630)
  });
}

// ── 3. 静的アセット ─────────────────────────────────────────────
cpSync(join(REPO_ROOT, 'icon.jpg'), join(DIST, 'icon.jpg'));
cpSync(join(REPO_ROOT, 'ogp.jpg'), join(DIST, 'ogp.jpg')); // Part I 用
cpSync(join(REPO_ROOT, 'ogp-ecs.jpg'), join(DIST, 'ogp-ecs.jpg')); // Part II 用
cpSync(join(REPO_ROOT, 'ogp-intro.jpg'), join(DIST, 'ogp-intro.jpg')); // 自己紹介用
console.log('  copied icon.jpg, ogp.jpg, ogp-ecs.jpg, ogp-intro.jpg');

// ── 4. 音声ファイル群 ───────────────────────────────────────────
cpSync(join(REPO_ROOT, 'audio'), join(DIST, 'audio'), { recursive: true });
cpSync(join(REPO_ROOT, 'audio-ecs'), join(DIST, 'audio-ecs'), { recursive: true });
console.log('  copied audio/ and audio-ecs/');

// ── 5. 完了サマリ ───────────────────────────────────────────────
console.log('');
console.log(`✅ dist/ built at ${DIST}`);
console.log(`   PUBLIC_URL = ${PUBLIC_URL || '(empty — 再 build 時に LT_STATIC_PUBLIC_URL を設定すれば OGP が埋まる)'}`);
