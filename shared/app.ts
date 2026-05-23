import { Hono } from 'hono';
import type { Context } from 'hono';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Hono アプリ本体。Lambda と ECS Express の **両方の配信先で動く同じコード**。
 *
 * LT の主張「1 つの技術で全部やるな、適材適所」を IaC 側で実証するために、
 *   - cdk-app/  (Lambda + Function URL)
 *   - ecs-app/  (ECS Express Mode + Fargate + ALB)
 * の 2 つのデプロイから、この `createApp()` を **同一引数で** 呼ぶ。
 *
 * インフラだけ差し替えて、アプリコードは 1 ミリも変えない、というのが今回の比較の純度。
 *
 * @see {@link AppOptions}
 */

export interface AppOptions {
  /**
   * 静的アセットのローカルディレクトリ(index.html / ogp.jpg / audio/ などが入る場所)。
   *
   * Lambda の場合は `/var/task/public`、ECS の場合は `/app/public` 相当。
   */
  readonly publicDir: string;

  /**
   * このデプロイの公開URL(末尾スラなし)。OGP/Twitter Card の `og:url` `og:image` に注入される。
   *
   * 例:
   *   - Lambda  : `https://xxxxx.lambda-url.ap-northeast-1.on.aws`
   *   - ECS Express: `https://ng-xxx.ecs.ap-northeast-1.on.aws`
   *
   * 未指定の場合は OGP に絶対URLが入らず SNS シェアで画像が表示されなくなる。
   */
  readonly publicUrl: string;

  /**
   * `/health` で返す `runtime` フィールド。
   * Lambda 側は `'lambda'`、ECS 側は `'ecs-express'` を渡す。
   *
   * ベンチマーク時に「どっちが応答したか」をワンクッションで判定できる。
   */
  readonly runtime: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.css': 'text/css',
  '.js': 'application/javascript; charset=utf-8',
};

const OGP_MARKER = '<!--__OGP__-->';

/**
 * 静的ファイルをパストラバーサル耐性つきで読み出す。
 *
 * - `publicDir` の外を指すパスは `null` を返す(攻撃可能性のあるパスは拒否)。
 * - Node の {@link Buffer} ではなく {@link Uint8Array} で返す。Hono の
 *   `c.body(...)` が期待する {@link Data} 型が `Uint8Array<ArrayBuffer>` で、
 *   `Buffer<ArrayBufferLike>` だと TS の型合致しないため、コピーして変換しておく。
 */
function readStatic(publicDir: string, relPath: string): { data: Uint8Array; contentType: string } | null {
  const fullPath = path.resolve(publicDir, relPath);
  const root = path.resolve(publicDir);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    return null;
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return null;
  }
  const buf = fs.readFileSync(fullPath);
  const data = new Uint8Array(buf.byteLength);
  data.set(buf);
  const ext = path.extname(fullPath).toLowerCase();
  return {
    data,
    contentType: MIME[ext] ?? 'application/octet-stream',
  };
}

/**
 * 1 ページ用の OGP / Twitter Card メタタグを生成する。
 *
 * デプロイごとに URL が変わるため(Lambda / ECS でホストが違う)、
 * HTML 側に静的に書かずに **実行時に埋め込む**。
 * これで HTML はリポジトリ上 1 本のソースに統一できる。
 */
function buildOgpTags(args: {
  publicUrl: string;
  pagePath: string;
  title: string;
  description: string;
  imagePath: string;
}): string {
  const url = `${args.publicUrl}${args.pagePath}`;
  const image = `${args.publicUrl}${args.imagePath}`;
  return [
    '<!-- OGP / Twitter Card (runtime-injected per deploy) -->',
    `<meta property="og:title" content="${args.title}">`,
    `<meta property="og:description" content="${args.description}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:secure_url" content="${image}">`,
    '<meta property="og:image:type" content="image/jpeg">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${args.title}">`, // shared/app.ts は `args.title` (引数 obj 名 = args のため)
    '<meta property="og:site_name" content="JAWS-UG LT by @takabo12786375">',
    '<meta property="og:locale" content="ja_JP">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:site" content="@takabo12786375">',
    '<meta name="twitter:creator" content="@takabo12786375">',
    `<meta name="twitter:title" content="${args.title}">`,
    `<meta name="twitter:description" content="${args.description}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<meta name="description" content="${args.description}">`,
    '<meta name="author" content="@takabo12786375">',
  ].join('\n');
}

/**
 * Hono アプリを構築する。
 *
 * Lambda 側は {@link import('hono/aws-lambda').handle} で、
 * ECS 側は {@link import('@hono/node-server').serve} でホスト。
 */
export function createApp(opts: AppOptions): Hono {
  const app = new Hono();

  // 共通: 静的ファイル送出ヘルパ(キャッシュ込み)。
  // `c.body()` の引数型 (`Uint8Array<ArrayBuffer>`) と Node の `Uint8Array<ArrayBufferLike>` の
  // 厳密ジェネリック差を埋めるためにキャストする(ランタイム上は同一)。
  const serveAsset = (c: Context, relPath: string, cacheSeconds: number) => {
    const file = readStatic(opts.publicDir, relPath);
    if (!file) return c.text('Not Found', 404);
    c.header('Content-Type', file.contentType);
    c.header('Cache-Control', `public, max-age=${cacheSeconds}`);
    c.header('X-Served-By', opts.runtime);
    return c.body(file.data as unknown as ArrayBuffer);
  };

  // ===== スライド配信のページハンドラ (Part I / Part II) =====
  //
  // ルーティング戦略:
  //   - `/lambda` (= Part I) と `/ecs` (= Part II) は **どの runtime でも** alias として常に有効
  //     (URL 共有しやすさのため固定)。
  //   - `/` (root) は **そのデプロイの "主役"** を返す:
  //       - Lambda 配信 (cdk-app)  → Part I (前回 LT URL のまま、 既存 SNS シェアと後方互換)
  //       - ECS Express 配信 (ecs-app) → Part II (このデプロイの存在理由 = 今回 LT)
  //
  // OGP は `pagePath: '/'` 固定で書き込むので、 どのパスで踏まれても SNS シェア時に
  // 各 deployment の根 URL を指す。 (Lambda root → Part I OGP, ECS root → Part II OGP)
  const partI = (c: Context) => {
    const file = readStatic(opts.publicDir, 'index.html');
    if (!file) return c.text('Not Found', 404);
    const ogp = buildOgpTags({
      publicUrl: opts.publicUrl,
      pagePath: '/',
      title: 'お前の Lambda それ API サーバーちゃうで',
      description:
        'JAWS-UG 静岡 LT 資料。Lambda を本業に戻す、2026年の設計論。― そして、この資料自体も Lambda + Hono で配信されています(意図的に)。',
      imagePath: '/ogp.jpg',
    });
    const html = new TextDecoder('utf-8').decode(file.data).replace(OGP_MARKER, ogp);
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=300');
    c.header('X-Served-By', opts.runtime);
    return c.body(html);
  };

  const partII = (c: Context) => {
    const file = readStatic(opts.publicDir, 'ecs.html');
    if (!file) return c.text('Not Found', 404);
    const ogp = buildOgpTags({
      publicUrl: opts.publicUrl,
      pagePath: '/',
      title: '机上の比較から、実地の検証へ — ECS Express 移行レポート',
      description:
        'JAWS-UG LT「お前の Lambda それ API サーバーちゃうで」の続編。Lambda + Hono 構成を ECS Express Mode に移し替えて、実測 RPS / P99 / コスト / コード行数を比較。',
      imagePath: '/ogp-ecs.jpg',
    });
    const html = new TextDecoder('utf-8').decode(file.data).replace(OGP_MARKER, ogp);
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=300');
    c.header('X-Served-By', opts.runtime);
    return c.body(html);
  };

  // 明示パス(常に有効)
  app.get('/lambda', partI);
  app.get('/ecs', partII);

  // 主役パス(deployment ごとに差し替え)
  if (opts.runtime === 'ecs-express') {
    app.get('/', partII);
  } else {
    app.get('/', partI);
  }

  // ===== 静的アセット =====
  app.get('/icon.jpg', (c) => serveAsset(c, 'icon.jpg', 86_400));
  app.get('/ogp.jpg', (c) => serveAsset(c, 'ogp.jpg', 86_400));

  // ===== 音声: 前回 LT =====
  app.get('/audio/:file', (c) => {
    const fileName = c.req.param('file');
    if (!/^slide_\d+\.mp3$/.test(fileName)) return c.text('Bad Request', 400);
    return serveAsset(c, `audio/${fileName}`, 86_400);
  });

  // ===== 音声: 次回 LT =====
  app.get('/audio-ecs/:file', (c) => {
    const fileName = c.req.param('file');
    if (!/^slide_\d+\.mp3$/.test(fileName)) return c.text('Bad Request', 400);
    return serveAsset(c, `audio-ecs/${fileName}`, 86_400);
  });

  // ===== ヘルスチェック(ベンチマーク/ALB 共用) =====
  // ECS Express では `HealthCheckPath` で参照される。Lambda では未使用だが、
  // 「同じアプリ・同じパスで動く」ことを示すために両方で公開しておく。
  app.get('/health', (c) =>
    c.json({
      ok: true,
      runtime: opts.runtime,
      publicUrl: opts.publicUrl,
      timestamp: new Date().toISOString(),
    }),
  );

  return app;
}
