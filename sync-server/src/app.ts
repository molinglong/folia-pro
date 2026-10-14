import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { COMPAT_SCOPE, resolveIdentity } from './identity.js';

export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

export type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type Env = {
  FOLIA_SYNC_DB: D1Database;
  SYNC_TOKEN: string;
  DASHBOARD_TOKEN?: string;
  /** 'false' 时关闭开放注册（仅 Node/Docker 形态读取）。 */
  ALLOW_REGISTER?: string;
};

export type SyncEnv = {
  Bindings: Env;
  Variables: {
    /** 数据域：'' = 兼容模式（全局 SYNC_TOKEN），否则为登录用户的 user_id。 */
    scopeId: string;
  };
};

const SCHEMA_VERSION = 3;
// 旧客户端（schema 1/2）只解析各自版本的响应，兼容模式按 1 应答，避免破坏存量部署。
const SUPPORTED_CLIENT_SCHEMA_VERSIONS = [1, 2, 3] as const;
const THEME_BUCKET_COUNT = 256;
const COLLECTION_PROVIDERS: ReadonlySet<string> = new Set(['netease', 'qq', 'kugou']);
const MAX_COLLECTION_JSON_LENGTH = 4_000_000;
// qqmusic_session token 是 qq-api 后端签发的不透明会话查找键，正常远小于此；上限只防滥用。
const MAX_PLATFORM_SESSION_TOKEN_LENGTH = 8_192;
const MAX_THEME_BATCH_SIZE = 500;
const MAX_THEME_BUCKET_REQUEST_SIZE = 32;
const DEFAULT_THEME_LIST_LIMIT = 500;
const MAX_THEME_LIST_LIMIT = 1000;

const hashSyncString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getThemeBucketId = (fingerprint: string) => hashSyncString(fingerprint) % THEME_BUCKET_COUNT;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const ensuredDatabases = new WeakSet<D1Database>();

const ensureSchema = async (db: D1Database) => {
  if (ensuredDatabases.has(db)) return;
  await db.batch([
    // 旧 schema 1 表保留不写：回滚到旧版本镜像时数据仍在。
    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS themes (
        fingerprint TEXT PRIMARY KEY,
        bucket_id INTEGER NOT NULL,
        theme_json TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS theme_buckets (
        bucket_id INTEGER PRIMARY KEY,
        count INTEGER NOT NULL,
        hash TEXT NOT NULL,
        updated_at TEXT
      )
    `),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_themes_updated_at ON themes(updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_themes_bucket_id ON themes(bucket_id)'),
    // schema 2：数据按 scope 隔离，'' = 兼容模式全局域（兼容旧表无法改主键，只能建新表）。
    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings_v2 (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS themes_v2 (
        scope TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        bucket_id INTEGER NOT NULL,
        theme_json TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, fingerprint)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS theme_buckets_v2 (
        scope TEXT NOT NULL,
        bucket_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        hash TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (scope, bucket_id)
      )
    `),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_themes_v2_scope_bucket ON themes_v2(scope, bucket_id)'),
    // 账号体系（Node/Docker 形态签发；Workers 形态没有 scrypt，session 校验永远不命中）。
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sessions (
        refresh_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        access_hash TEXT NOT NULL,
        device_label TEXT,
        created_at TEXT NOT NULL,
        access_expires_at TEXT NOT NULL,
        refresh_expires_at TEXT NOT NULL,
        last_seen_at TEXT
      )
    `),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_access_hash ON sessions(access_hash)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)'),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS collections (
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider_id)
      )
    `),
    // schema 3：平台会话键（共享登录态，见 docs/qq-shared-session-design.md）。只存后端签发的
    // 不透明 token，凭证本体始终留在 qq-api 后端的加密会话仓库里。
    db.prepare(`
      CREATE TABLE IF NOT EXISTS platform_sessions (
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        token TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider_id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `),
  ]);

  // 一次性迁移：把 schema 1 的全局数据搬进兼容模式域（scope = ''）。meta 行幂等防重放，
  // 否则每次冷启动都会把旧表数据复活（用户删过的数据被 INSERT OR IGNORE 重新插入）。
  const migrationRow = await db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .bind('migration_v2_done')
    .first<{ value: string }>();
  if (!migrationRow) {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO settings_v2 (scope, key, value_json, updated_at) SELECT '', key, value_json, updated_at FROM settings"),
      db.prepare("INSERT OR IGNORE INTO themes_v2 (scope, fingerprint, bucket_id, theme_json, source, updated_at) SELECT '', fingerprint, bucket_id, theme_json, source, updated_at FROM themes"),
      db.prepare("INSERT OR IGNORE INTO theme_buckets_v2 (scope, bucket_id, count, hash, updated_at) SELECT '', bucket_id, count, hash, updated_at FROM theme_buckets"),
      db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('migration_v2_done', '1')"),
    ]);
    console.log('[Sync] Migrated schema 1 global data into compat scope');
  }
  ensuredDatabases.add(db);
};

const parseThemeInput = (value: unknown) => {
  if (!isRecord(value)
    || typeof value.fingerprint !== 'string'
    || !value.fingerprint
    || typeof value.updatedAt !== 'string'
    || !isRecord(value.theme)
  ) {
    return null;
  }
  const source = value.source === 'auto' || value.source === 'fallback' || value.source === 'edited'
    ? value.source
    : 'manual';
  return { fingerprint: value.fingerprint, theme: value.theme, updatedAt: value.updatedAt, source };
};

const mapThemeRow = (row: { fingerprint: string; theme_json: string; source: string; updated_at: string }) => ({
  fingerprint: row.fingerprint,
  theme: JSON.parse(row.theme_json),
  source: row.source,
  updatedAt: row.updated_at,
});



const getThemeManifest = async (db: D1Database, scopeId: string) => {
  const rows = await db
    .prepare('SELECT bucket_id, count, hash, updated_at FROM theme_buckets_v2 WHERE scope = ?')
    .bind(scopeId)
    .all<{ bucket_id: number; count: number; hash: string; updated_at: string | null }>();
  const buckets = Array.from({ length: THEME_BUCKET_COUNT }, (_, bucketId) => ({
    bucketId, count: 0, hash: '0', updatedAt: null as string | null,
  }));
  (rows.results ?? []).forEach((row) => {
    if (Number.isInteger(row.bucket_id) && row.bucket_id >= 0 && row.bucket_id < THEME_BUCKET_COUNT) {
      buckets[row.bucket_id] = {
        bucketId: row.bucket_id, count: Number(row.count), hash: row.hash, updatedAt: row.updated_at,
      };
    }
  });
  return {
    schemaVersion: scopeId === COMPAT_SCOPE ? 1 : 2,
    bucketCount: THEME_BUCKET_COUNT,
    buckets,
  };
};

const app = new Hono<SyncEnv>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// Token length validation middleware
app.use('*', async (c, next) => {
  if (!c.env.SYNC_TOKEN || c.env.SYNC_TOKEN.length < 8) {
    return c.json({ ok: false, error: 'SYNC_TOKEN is too weak. Must be at least 8 characters long.' }, 500);
  }
  await next();
});

// Initialize Schema
app.use('*', async (c, next) => {
  if (c.req.path !== '/') {
    await ensureSchema(c.env.FOLIA_SYNC_DB);
  }
  await next();
});

// Dashboard Route
app.get('/', async (c) => {
  const dashboardToken = c.env.DASHBOARD_TOKEN;
  const reqToken = c.req.query('token');
  
  if (!dashboardToken || reqToken !== dashboardToken) {
    return c.text('Not Found', 404);
  }

  await ensureSchema(c.env.FOLIA_SYNC_DB);

  const settingsRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT updated_at FROM settings_v2 ORDER BY updated_at DESC LIMIT 1')
    .first<{ updated_at: string }>();

  const themesRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT MAX(updated_at) AS themesUpdatedAt, SUM(count) AS themeCount FROM theme_buckets_v2')
    .first<{ themesUpdatedAt: string | null; themeCount: number }>();

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Folia Sync Server</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #000000;
            --dot-color: rgba(255, 255, 255, 0.1);
            --text-main: #ffffff;
            --text-muted: #94a3b8;
            --border-color: rgba(255, 255, 255, 0.1);
        }
        * { box-sizing: border-box; }
        body { 
            font-family: 'Inter', system-ui, sans-serif; 
            background-color: var(--bg-color);
            background-image: radial-gradient(var(--dot-color) 1px, transparent 1px);
            background-size: 24px 24px;
            color: var(--text-main); 
            min-height: 100vh;
            margin: 0;
            display: flex; 
            flex-direction: column;
            align-items: center;
            padding: 4rem 2rem; 
        }
        .header {
            width: 100%;
            max-width: 900px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5rem;
        }
        .title {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 0;
            letter-spacing: 0.02em;
        }
        .version-pill {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid var(--border-color);
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 500;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            color: #cbd5e1;
        }
        .content {
            width: 100%;
            max-width: 900px;
        }
        .stats-grid { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 2rem; 
            align-items: center;
        }
        .stat-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            gap: 1rem;
        }
        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--text-main);
            line-height: 1.2;
        }
        .stat-value.text-base {
            font-size: 1.25rem;
            font-weight: 600;
        }
        .stat-label {
            font-size: 0.875rem;
            color: var(--text-main);
            font-weight: 500;
            letter-spacing: 0.05em;
        }
        .footer-note {
            margin-top: 5rem;
            padding-top: 1.5rem;
            border-top: 1px dashed var(--border-color);
            font-size: 0.875rem;
            color: var(--text-muted);
            line-height: 1.6;
        }
        .footer-note code {
            background: rgba(255, 255, 255, 0.1);
            padding: 0.15rem 0.35rem;
            border-radius: 4px;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            color: #e2e8f0;
        }
        .footer-note ul {
            margin: 0.5rem 0 0 0;
            padding-left: 1.25rem;
        }
        .footer-note li {
            margin-bottom: 0.25rem;
        }
        @media (max-width: 768px) {
            .stats-grid { grid-template-columns: 1fr; gap: 3rem; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 class="title">Folia Sync Server</h1>
        <div class="version-pill">v1.0.0</div>
    </div>
    
    <div class="content">
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">${Number(themesRow?.themeCount ?? 0)}</div>
                <div class="stat-label">已同步主题数</div>
            </div>
            <div class="stat-item">
                <div class="stat-value text-base">${themesRow?.themesUpdatedAt ? new Date(themesRow.themesUpdatedAt).toLocaleString('zh-CN') : '暂无数据'}</div>
                <div class="stat-label">主题最近更新</div>
            </div>
            <div class="stat-item">
                <div class="stat-value text-base">${settingsRow?.updated_at ? new Date(settingsRow.updated_at).toLocaleString('zh-CN') : '暂无数据'}</div>
                <div class="stat-label">设置最近更新</div>
            </div>
        </div>

        <div class="footer-note">
            如果你遗忘了 <code>SYNC_TOKEN</code> 密钥：
            <ul>
                <li><strong>Cloudflare 部署</strong>：运行 <code>wrangler secret put SYNC_TOKEN</code> 重置覆盖。</li>
                <li><strong>自托管 (Node.js)</strong>：请检查服务器的 <code>.env</code> 文件配置。</li>
            </ul>
        </div>
    </div>
</body>
</html>`;

  return c.html(html);
});

// API Routes
app.get('/health', (c) => c.json({
  ok: true,
  schemaVersion: SCHEMA_VERSION,
  supportedSchemaVersions: SUPPORTED_CLIENT_SCHEMA_VERSIONS,
  backend: 'hono-sync',
}));

const api = new Hono<SyncEnv>();

// 身份解析：全局 SYNC_TOKEN → 兼容模式（scope = ''），用户 session token → 账号数据域。
// /auth/* 与 /admin/* 自带鉴权语义（或明确无鉴权），不参与解析，
// 否则挂在根路径的这层中间件会把账号路由全部拦截成 401。
api.use('*', async (c, next) => {
  if (c.req.path.startsWith('/auth/') || c.req.path.startsWith('/admin/')) {
    await next();
    return;
  }
  return await resolveIdentity(c, next);
});

api.get('/state', async (c) => {
  const scopeId = c.get('scopeId');
  const settingsRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT updated_at FROM settings_v2 WHERE scope = ? AND key = ?')
    .bind(scopeId, 'visual')
    .first<{ updated_at: string }>();
  const themesRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT MAX(updated_at) AS themesUpdatedAt, SUM(count) AS themeCount FROM theme_buckets_v2 WHERE scope = ?')
    .bind(scopeId)
    .first<{ themesUpdatedAt: string | null; themeCount: number }>();
  return c.json({
    schemaVersion: scopeId === COMPAT_SCOPE ? 1 : 2,
    scoped: scopeId !== COMPAT_SCOPE,
    settingsUpdatedAt: settingsRow?.updated_at ?? null,
    themesUpdatedAt: themesRow?.themesUpdatedAt ?? null,
    themeCount: Number(themesRow?.themeCount ?? 0),
  });
});

api.get('/settings', async (c) => {
  const row = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT value_json FROM settings_v2 WHERE scope = ? AND key = ?')
    .bind(c.get('scopeId'), 'visual')
    .first<{ value_json: string }>();
  return c.json(row ? JSON.parse(row.value_json) : null);
});

api.get('/themes/manifest', async (c) => c.json(await getThemeManifest(c.env.FOLIA_SYNC_DB, c.get('scopeId'))));

api.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  // 同时接受 schema 1/2：存量客户端（1）与账号客户端（2）共存期间都能写入。
  const inputSchemaVersion = body?.schemaVersion;
  if (!body
    || (inputSchemaVersion !== 1 && inputSchemaVersion !== 2)
    || typeof body.updatedAt !== 'string'
    || !isRecord(body.data)
  ) {
    return c.json({ ok: false, error: 'invalid_settings' }, 400);
  }
  await c.env.FOLIA_SYNC_DB
    .prepare(`
      INSERT INTO settings_v2 (scope, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= settings_v2.updated_at
    `)
    .bind(c.get('scopeId'), 'visual', JSON.stringify(body), body.updatedAt)
    .run();

  console.log(`[Sync] Updated settings (scope: ${c.get('scopeId') || 'compat'}, timestamp: ${body.updatedAt})`);
  return c.json({ ok: true });
});

api.post('/themes/get', async (c) => {
  const body = await c.req.json<{ fingerprints?: unknown[] }>().catch(() => null);
  const fingerprints = Array.from(new Set((body?.fingerprints ?? []).filter((value): value is string => (
    typeof value === 'string' && Boolean(value)
  )))).slice(0, MAX_THEME_BATCH_SIZE);
  if (fingerprints.length === 0) return c.json({ themes: [] });

  const placeholders = fingerprints.map(() => '?').join(',');
  const rows = await c.env.FOLIA_SYNC_DB
    .prepare(`SELECT fingerprint, theme_json, source, updated_at FROM themes_v2 WHERE scope = ? AND fingerprint IN (${placeholders})`)
    .bind(c.get('scopeId'), ...fingerprints)
    .all<{ fingerprint: string; theme_json: string; source: string; updated_at: string }>();
  return c.json({ themes: (rows.results ?? []).map(mapThemeRow) });
});

api.post('/themes/put', async (c) => {
  const body = await c.req.json<{ themes?: unknown[] }>().catch(() => null);
  const themes = (body?.themes ?? []).map(parseThemeInput);
  if (themes.some(theme => !theme) || themes.length > MAX_THEME_BATCH_SIZE) {
    return c.json({ ok: false, error: 'invalid_themes' }, 400);
  }

  const validThemes = themes as NonNullable<ReturnType<typeof parseThemeInput>>[];
  if (validThemes.length === 0) {
    return c.json({ ok: true, savedCount: 0 });
  }

  const fingerprints = validThemes.map(t => t.fingerprint);
  const placeholders = fingerprints.map(() => '?').join(',');
  
  const scopeId = c.get('scopeId');
  const oldRows = await c.env.FOLIA_SYNC_DB
    .prepare(`SELECT fingerprint, updated_at FROM themes_v2 WHERE scope = ? AND fingerprint IN (${placeholders})`)
    .bind(scopeId, ...fingerprints)
    .all<{ fingerprint: string; updated_at: string }>();
    
  const oldThemesMap = new Map(oldRows.results?.map(r => [r.fingerprint, r.updated_at]) ?? []);
  const bucketDiffs = new Map<number, { countDelta: number; hashDelta: number; maxUpdatedAt: string }>();

  validThemes.forEach(theme => {
    const bucketId = getThemeBucketId(theme.fingerprint);
    let bucketDiff = bucketDiffs.get(bucketId);
    if (!bucketDiff) {
      bucketDiff = { countDelta: 0, hashDelta: 0, maxUpdatedAt: theme.updatedAt };
      bucketDiffs.set(bucketId, bucketDiff);
    }
    
    const oldUpdatedAt = oldThemesMap.get(theme.fingerprint);
    if (!oldUpdatedAt) {
      bucketDiff.countDelta += 1;
      bucketDiff.hashDelta ^= hashSyncString(`${theme.fingerprint}\u0000${theme.updatedAt}`);
    } else if (theme.updatedAt >= oldUpdatedAt) {
      bucketDiff.hashDelta ^= hashSyncString(`${theme.fingerprint}\u0000${oldUpdatedAt}`);
      bucketDiff.hashDelta ^= hashSyncString(`${theme.fingerprint}\u0000${theme.updatedAt}`);
    }

    if (Date.parse(theme.updatedAt) > Date.parse(bucketDiff.maxUpdatedAt)) {
       bucketDiff.maxUpdatedAt = theme.updatedAt;
    }
  });

  const batchStatements: D1PreparedStatement[] = [];

  validThemes.forEach(theme => {
    batchStatements.push(c.env.FOLIA_SYNC_DB.prepare(`
      INSERT INTO themes_v2 (scope, fingerprint, bucket_id, theme_json, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, fingerprint) DO UPDATE SET
        bucket_id = excluded.bucket_id,
        theme_json = excluded.theme_json,
        source = excluded.source,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= themes_v2.updated_at
    `).bind(
      scopeId,
      theme.fingerprint,
      getThemeBucketId(theme.fingerprint),
      JSON.stringify(theme.theme),
      theme.source,
      theme.updatedAt,
    ));
  });

  bucketDiffs.forEach((diff, bucketId) => {
    batchStatements.push(c.env.FOLIA_SYNC_DB.prepare(`
      INSERT INTO theme_buckets_v2 (scope, bucket_id, count, hash, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope, bucket_id) DO UPDATE SET
        count = theme_buckets_v2.count + excluded.count,
        hash = CAST(((CAST(theme_buckets_v2.hash AS INTEGER) | CAST(excluded.hash AS INTEGER)) - (CAST(theme_buckets_v2.hash AS INTEGER) & CAST(excluded.hash AS INTEGER))) AS TEXT),
        updated_at = MAX(theme_buckets_v2.updated_at, excluded.updated_at)
    `).bind(
      scopeId,
      bucketId,
      diff.countDelta,
      String(diff.hashDelta >>> 0),
      diff.maxUpdatedAt,
    ));
  });

  await c.env.FOLIA_SYNC_DB.batch(batchStatements);
  
  console.log(`[Sync] Saved ${validThemes.length} themes (batch update)`);
  return c.json({ ok: true, savedCount: validThemes.length });
});

api.post('/themes/bucket', async (c) => {
  const body = await c.req.json<{ bucketIds?: unknown[] }>().catch(() => null);
  const bucketIds = Array.from(new Set((body?.bucketIds ?? []).filter((value): value is number => (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < THEME_BUCKET_COUNT
  )))).slice(0, MAX_THEME_BUCKET_REQUEST_SIZE);
  if (bucketIds.length === 0) return c.json({ themes: [] });

  const placeholders = bucketIds.map(() => '?').join(',');
  const rows = await c.env.FOLIA_SYNC_DB
    .prepare(`
      SELECT fingerprint, theme_json, source, updated_at
      FROM themes_v2
      WHERE scope = ? AND bucket_id IN (${placeholders})
      ORDER BY fingerprint ASC
    `)
    .bind(c.get('scopeId'), ...bucketIds)
    .all<{ fingerprint: string; theme_json: string; source: string; updated_at: string }>();
  return c.json({ themes: (rows.results ?? []).map(mapThemeRow) });
});

api.post('/themes/list', async (c) => {
  const body = await c.req.json<{ cursor?: unknown; limit?: unknown }>().catch(() => null);
  const cursor = typeof body?.cursor === 'string' ? body.cursor : '';
  const requestedLimit = typeof body?.limit === 'number' && Number.isFinite(body.limit)
    ? Math.trunc(body.limit)
    : DEFAULT_THEME_LIST_LIMIT;
  const limit = Math.max(1, Math.min(MAX_THEME_LIST_LIMIT, requestedLimit));
  const rows = await c.env.FOLIA_SYNC_DB
    .prepare(`
      SELECT fingerprint, theme_json, source, updated_at
      FROM themes_v2
      WHERE scope = ? AND fingerprint > ?
      ORDER BY fingerprint ASC
      LIMIT ?
    `)
    .bind(c.get('scopeId'), cursor, limit)
    .all<{ fingerprint: string; theme_json: string; source: string; updated_at: string }>();
  const themes = (rows.results ?? []).map(mapThemeRow);
  return c.json({
    themes,
    cursor: themes.length === limit ? themes[themes.length - 1].fingerprint : null,
  });
});

// --- 收藏/歌单快照（账号数据域；兼容模式不可用，schemaVersion 独立从 1 起计）---

api.get('/collections/:providerId', async (c) => {
  const scopeId = c.get('scopeId');
  if (scopeId === COMPAT_SCOPE) {
    return c.json({ ok: false, error: 'account_required' }, 403);
  }
  const providerId = c.req.param('providerId');
  if (!COLLECTION_PROVIDERS.has(providerId)) {
    return c.json({ ok: false, error: 'invalid_provider' }, 400);
  }
  const row = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT value_json FROM collections WHERE user_id = ? AND provider_id = ?')
    .bind(scopeId, providerId)
    .first<{ value_json: string }>();
  return c.json(row ? JSON.parse(row.value_json) : null);
});

api.put('/collections/:providerId', async (c) => {
  const scopeId = c.get('scopeId');
  if (scopeId === COMPAT_SCOPE) {
    return c.json({ ok: false, error: 'account_required' }, 403);
  }
  const providerId = c.req.param('providerId');
  if (!COLLECTION_PROVIDERS.has(providerId)) {
    return c.json({ ok: false, error: 'invalid_provider' }, 400);
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || body.schemaVersion !== 1 || typeof body.updatedAt !== 'string' || !isRecord(body.data)) {
    return c.json({ ok: false, error: 'invalid_collection' }, 400);
  }
  const data = body.data;
  if (!Array.isArray(data.collections) || !Array.isArray(data.likedSongIds)) {
    return c.json({ ok: false, error: 'invalid_collection' }, 400);
  }
  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_COLLECTION_JSON_LENGTH) {
    return c.json({ ok: false, error: 'collection_too_large' }, 413);
  }

  // LWW：远端已有更新快照时拒绝旧写入（先读后写，单人使用无并发风险）。
  const existing = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT updated_at FROM collections WHERE user_id = ? AND provider_id = ?')
    .bind(scopeId, providerId)
    .first<{ updated_at: string }>();
  if (existing && body.updatedAt < existing.updated_at) {
    return c.json({ ok: false, error: 'stale_write', updatedAt: existing.updated_at }, 409);
  }

  await c.env.FOLIA_SYNC_DB
    .prepare(`
      INSERT INTO collections (user_id, provider_id, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, provider_id) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `)
    .bind(scopeId, providerId, serialized, body.updatedAt)
    .run();

  console.log(`[Sync] Updated collections (${providerId}, timestamp: ${body.updatedAt})`);
  return c.json({ ok: true });
});

// --- 平台会话键（账号数据域；载荷只含 token，见设计文档 §5.4 安全断言）---

api.get('/platform-sessions/:providerId', async (c) => {
  const scopeId = c.get('scopeId');
  if (scopeId === COMPAT_SCOPE) {
    return c.json({ ok: false, error: 'account_required' }, 403);
  }
  const providerId = c.req.param('providerId');
  if (!COLLECTION_PROVIDERS.has(providerId)) {
    return c.json({ ok: false, error: 'invalid_provider' }, 400);
  }
  const row = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT token, updated_at FROM platform_sessions WHERE user_id = ? AND provider_id = ?')
    .bind(scopeId, providerId)
    .first<{ token: string; updated_at: string }>();
  return c.json(row ? { token: row.token, updatedAt: row.updated_at } : null);
});

api.put('/platform-sessions/:providerId', async (c) => {
  const scopeId = c.get('scopeId');
  if (scopeId === COMPAT_SCOPE) {
    return c.json({ ok: false, error: 'account_required' }, 403);
  }
  const providerId = c.req.param('providerId');
  if (!COLLECTION_PROVIDERS.has(providerId)) {
    return c.json({ ok: false, error: 'invalid_provider' }, 400);
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  // 安全断言：只接受 schemaVersion/updatedAt/token 三键，多余字段直接拒绝——
  // 该域的唯一合法载荷就是后端会话查找键，不得变成第二个凭证存放处。
  if (!body
    || body.schemaVersion !== 1
    || typeof body.updatedAt !== 'string'
    || typeof body.token !== 'string'
    || body.token.length === 0
    || Object.keys(body).some((key) => key !== 'schemaVersion' && key !== 'updatedAt' && key !== 'token')) {
    return c.json({ ok: false, error: 'invalid_platform_session' }, 400);
  }
  if (body.token.length > MAX_PLATFORM_SESSION_TOKEN_LENGTH) {
    return c.json({ ok: false, error: 'platform_session_too_large' }, 413);
  }

  // LWW：最新扫码者胜，与"一个活跃会话"的共享语义一致。
  const existing = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT updated_at FROM platform_sessions WHERE user_id = ? AND provider_id = ?')
    .bind(scopeId, providerId)
    .first<{ updated_at: string }>();
  if (existing && body.updatedAt < existing.updated_at) {
    return c.json({ ok: false, error: 'stale_write', updatedAt: existing.updated_at }, 409);
  }

  await c.env.FOLIA_SYNC_DB
    .prepare(`
      INSERT INTO platform_sessions (user_id, provider_id, token, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, provider_id) DO UPDATE SET
        token = excluded.token,
        updated_at = excluded.updated_at
    `)
    .bind(scopeId, providerId, body.token, body.updatedAt)
    .run();

  console.log(`[Sync] Updated platform-sessions (${providerId}, timestamp: ${body.updatedAt})`);
  return c.json({ ok: true });
});

api.delete('/platform-sessions/:providerId', async (c) => {
  const scopeId = c.get('scopeId');
  if (scopeId === COMPAT_SCOPE) {
    return c.json({ ok: false, error: 'account_required' }, 403);
  }
  const providerId = c.req.param('providerId');
  if (!COLLECTION_PROVIDERS.has(providerId)) {
    return c.json({ ok: false, error: 'invalid_provider' }, 400);
  }
  // 条件删除：登出请求带上它见过的 updatedAt，避免把另一台设备刚扫码写入的新 token 删掉。
  const ifUpdatedAt = c.req.query('ifUpdatedAt');
  const existing = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT updated_at FROM platform_sessions WHERE user_id = ? AND provider_id = ?')
    .bind(scopeId, providerId)
    .first<{ updated_at: string }>();
  if (!existing) {
    return c.json({ ok: true });
  }
  if (ifUpdatedAt !== undefined && ifUpdatedAt !== existing.updated_at) {
    return c.json({ ok: false, error: 'stale_write', updatedAt: existing.updated_at }, 409);
  }
  await c.env.FOLIA_SYNC_DB
    .prepare('DELETE FROM platform_sessions WHERE user_id = ? AND provider_id = ?')
    .bind(scopeId, providerId)
    .run();
  console.log(`[Sync] Deleted platform-sessions (${providerId})`);
  return c.json({ ok: true });
});

app.route('/', api);

export default app;
