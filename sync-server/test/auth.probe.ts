import assert from 'node:assert/strict';
import app from '../src/app.js';
import { createAuthRouter } from '../src/auth.js';
import { D1Emulator } from '../src/d1-emulator.js';
import type { Env } from '../src/app.js';

// 手工探针：npm run test:node（tsx test/auth.probe.ts）
// 覆盖：注册/登录/会话旋转/登出、兼容模式回归（schema 1 语义）、用户数据域隔离、
// collections LWW、登录限速、关闭注册 + 管理员建号、一次性迁移幂等。

app.route('/', createAuthRouter());

const SYNC_TOKEN = 'probe-sync-token-01';
const DASHBOARD_TOKEN = 'probe-dashboard-token-01';

type EnvOverrides = Partial<Omit<Env, 'FOLIA_SYNC_DB'>>;

let envCounter = 0;
const makeEnv = (overrides: EnvOverrides = {}): Env => {
  envCounter += 1;
  return {
    FOLIA_SYNC_DB: new D1Emulator(':memory:'),
    SYNC_TOKEN,
    DASHBOARD_TOKEN,
    ALLOW_REGISTER: 'true',
    ...overrides,
  };
};

type JsonResponse = { status: number; body: any };

const requestJson = async (env: Env, path: string, init: RequestInit = {}): Promise<JsonResponse> => {
  const response = await app.request(path, init, env);
  return { status: response.status, body: await response.json().catch(() => null) };
};

const postJson = (env: Env, path: string, payload: unknown, token?: string) => (
  requestJson(env, path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
);

const putJson = (env: Env, path: string, payload: unknown, token?: string) => (
  requestJson(env, path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
);

const registerUser = async (env: Env, email: string, password: string) => (
  postJson(env, '/auth/register', { email, password, deviceLabel: 'probe' })
);

const settingsBody = (schemaVersion: number, updatedAt: string) => ({
  schemaVersion,
  updatedAt,
  data: { visualizerMode: `bar-${schemaVersion}-${updatedAt}` },
});

const themeRecord = (fingerprint: string, updatedAt: string) => ({
  fingerprint,
  theme: { colors: [fingerprint, updatedAt] },
  source: 'manual',
  updatedAt,
});

const section = async (name: string, run: () => Promise<void>) => {
  console.log(`\n== ${name}`);
  await run();
  console.log('   OK');
};

const main = async () => {
  await section('兼容模式回归：全局 SYNC_TOKEN 的 schema 1 语义不变', async () => {
    const env = makeEnv();

    const unauthorized = await requestJson(env, '/state');
    assert.equal(unauthorized.status, 401);

    const put = await putJson(env, '/settings', settingsBody(1, '2026-01-01T00:00:00.000Z'), SYNC_TOKEN);
    assert.equal(put.status, 200);
    assert.equal(put.body.ok, true);

    const get = await requestJson(env, '/settings', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(get.status, 200);
    assert.equal(get.body.schemaVersion, 1);
    assert.equal(get.body.data.visualizerMode, 'bar-1-2026-01-01T00:00:00.000Z');

    const state = await requestJson(env, '/state', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(state.status, 200);
    assert.equal(state.body.schemaVersion, 1);
    assert.equal(state.body.scoped, false);

    const manifest = await requestJson(env, '/themes/manifest', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.body.schemaVersion, 1);

    const putTheme = await postJson(env, '/themes/put', { themes: [themeRecord('fp-compat-1', '2026-01-01T00:00:00.000Z')] }, SYNC_TOKEN);
    assert.equal(putTheme.status, 200);
    assert.equal(putTheme.body.savedCount, 1);

    const getTheme = await postJson(env, '/themes/get', { fingerprints: ['fp-compat-1'] }, SYNC_TOKEN);
    assert.equal(getTheme.body.themes.length, 1);

    const list = await postJson(env, '/themes/list', {}, SYNC_TOKEN);
    assert.equal(list.body.themes.length, 1);

    // 新的 collections 路由对兼容模式必须明确拒绝，而不是静默混用数据域。
    const collectionsDenied = await requestJson(env, '/collections/netease', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(collectionsDenied.status, 403);
  });

  await section('账号生命周期：注册 / 会话 / 旋转 / 登出', async () => {
    const env = makeEnv();

    const registered = await registerUser(env, '  Alice@Example.com ', 'password-123');
    assert.equal(registered.status, 201);
    assert.equal(registered.body.email, 'alice@example.com');
    assert.ok(registered.body.accessToken.length >= 64);
    assert.ok(registered.body.refreshToken.length >= 128);

    const me = await requestJson(env, '/auth/me', { headers: { Authorization: `Bearer ${registered.body.accessToken}` } });
    assert.equal(me.status, 200);
    assert.equal(me.body.email, 'alice@example.com');

    const meCompat = await requestJson(env, '/auth/me', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(meCompat.status, 403);

    const refreshed = await postJson(env, '/auth/refresh', { refreshToken: registered.body.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.refreshToken, registered.body.refreshToken);

    // 旋转后旧 refresh 立即作废。
    const replay = await postJson(env, '/auth/refresh', { refreshToken: registered.body.refreshToken });
    assert.equal(replay.status, 401);

    const meNew = await requestJson(env, '/auth/me', { headers: { Authorization: `Bearer ${refreshed.body.accessToken}` } });
    assert.equal(meNew.status, 200);

    const loggedIn = await postJson(env, '/auth/login', { email: 'alice@example.com', password: 'password-123' });
    assert.equal(loggedIn.status, 200);

    const wrongPassword = await postJson(env, '/auth/login', { email: 'alice@example.com', password: 'wrong-password' });
    assert.equal(wrongPassword.status, 401);

    const unknownEmail = await postJson(env, '/auth/login', { email: 'ghost@example.com', password: 'wrong-password' });
    assert.equal(unknownEmail.status, 401);
    assert.equal(unknownEmail.body.error, 'invalid_credentials');

    const loggedOut = await postJson(env, '/auth/logout', { refreshToken: loggedIn.body.refreshToken });
    assert.equal(loggedOut.status, 200);
    const afterLogout = await postJson(env, '/auth/refresh', { refreshToken: loggedIn.body.refreshToken });
    assert.equal(afterLogout.status, 401);

    const duplicate = await registerUser(env, 'alice@example.com', 'password-456');
    assert.equal(duplicate.status, 409);

    const weak = await registerUser(env, 'bob@example.com', 'short');
    assert.equal(weak.status, 400);
  });

  await section('用户数据域隔离：双账号互不可见，兼容域独立', async () => {
    const env = makeEnv();
    const userA = (await registerUser(env, 'a@example.com', 'password-123')).body;
    const userB = (await registerUser(env, 'b@example.com', 'password-456')).body;

    const putA = await putJson(env, '/settings', settingsBody(2, '2026-01-02T00:00:00.000Z'), userA.accessToken);
    assert.equal(putA.status, 200);

    const getA = await requestJson(env, '/settings', { headers: { Authorization: `Bearer ${userA.accessToken}` } });
    assert.equal(getA.body.data.visualizerMode, 'bar-2-2026-01-02T00:00:00.000Z');

    const getB = await requestJson(env, '/settings', { headers: { Authorization: `Bearer ${userB.accessToken}` } });
    assert.equal(getB.body, null);

    const getCompat = await requestJson(env, '/settings', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(getCompat.body, null);

    const stateA = await requestJson(env, '/state', { headers: { Authorization: `Bearer ${userA.accessToken}` } });
    assert.equal(stateA.body.schemaVersion, 2);
    assert.equal(stateA.body.scoped, true);

    const putThemeA = await postJson(env, '/themes/put', { themes: [themeRecord('fp-a-1', '2026-01-02T00:00:00.000Z')] }, userA.accessToken);
    assert.equal(putThemeA.body.savedCount, 1);

    const manifestB = await requestJson(env, '/themes/manifest', { headers: { Authorization: `Bearer ${userB.accessToken}` } });
    assert.equal(manifestB.body.buckets.reduce((sum: number, bucket: { count: number }) => sum + bucket.count, 0), 0);

    const themeB = await postJson(env, '/themes/get', { fingerprints: ['fp-a-1'] }, userB.accessToken);
    assert.equal(themeB.body.themes.length, 0);

    const themeA = await postJson(env, '/themes/get', { fingerprints: ['fp-a-1'] }, userA.accessToken);
    assert.equal(themeA.body.themes.length, 1);
  });

  await section('collections：LWW 与跨用户隔离', async () => {
    const env = makeEnv();
    const userA = (await registerUser(env, 'a@example.com', 'password-123')).body;
    const userB = (await registerUser(env, 'b@example.com', 'password-456')).body;

    const payload = (updatedAt: string) => ({
      schemaVersion: 1,
      updatedAt,
      data: { user: { uid: 'u1', name: 'A' }, collections: [], likedSongIds: ['s1', 's2'] },
    });

    const put1 = await putJson(env, '/collections/netease', payload('2026-01-02T00:00:00.000Z'), userA.accessToken);
    assert.equal(put1.status, 200);

    const stale = await putJson(env, '/collections/netease', payload('2026-01-01T00:00:00.000Z'), userA.accessToken);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'stale_write');

    const get1 = await requestJson(env, '/collections/netease', { headers: { Authorization: `Bearer ${userA.accessToken}` } });
    assert.deepEqual(get1.body.data.likedSongIds, ['s1', 's2']);

    const newer = await putJson(env, '/collections/netease', {
      schemaVersion: 1,
      updatedAt: '2026-01-03T00:00:00.000Z',
      data: { user: { uid: 'u1', name: 'A' }, collections: [], likedSongIds: ['s1', 's3'] },
    }, userA.accessToken);
    assert.equal(newer.status, 200);

    const get2 = await requestJson(env, '/collections/netease', { headers: { Authorization: `Bearer ${userA.accessToken}` } });
    assert.deepEqual(get2.body.data.likedSongIds, ['s1', 's3']);

    const crossUser = await requestJson(env, '/collections/netease', { headers: { Authorization: `Bearer ${userB.accessToken}` } });
    assert.equal(crossUser.body, null);

    const invalidProvider = await putJson(env, '/collections/bilibili', payload('2026-01-04T00:00:00.000Z'), userA.accessToken);
    assert.equal(invalidProvider.status, 400);
  });

  await section('登录限速：5 次失败后锁定', async () => {
    const env = makeEnv();
    await registerUser(env, 'victim@example.com', 'password-123');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await postJson(env, '/auth/login', { email: 'victim@example.com', password: `wrong-${attempt}` });
      assert.equal(failed.status, 401);
    }

    // 锁定期间正确密码也拒绝。
    const locked = await postJson(env, '/auth/login', { email: 'victim@example.com', password: 'password-123' });
    assert.equal(locked.status, 429);

    // 另一个邮箱不受同一把锁影响（key 含 email）。
    const other = await registerUser(env, 'other@example.com', 'password-456');
    assert.equal(other.status, 201);
  });

  await section('关闭注册 + 管理员建号', async () => {
    const env = makeEnv({ ALLOW_REGISTER: 'false' });

    const blocked = await registerUser(env, 'new@example.com', 'password-123');
    assert.equal(blocked.status, 403);

    const unauthorizedAdmin = await postJson(env, '/admin/users', { email: 'admin-made@example.com', password: 'password-123' });
    assert.equal(unauthorizedAdmin.status, 404);

    const created = await postJson(env, '/admin/users', { email: 'admin-made@example.com', password: 'password-123' }, DASHBOARD_TOKEN);
    assert.equal(created.status, 201);

    const loggedIn = await postJson(env, '/auth/login', { email: 'admin-made@example.com', password: 'password-123' });
    assert.equal(loggedIn.status, 200);
  });

  await section('一次性迁移：schema 1 数据进兼容域，meta 幂等防重放', async () => {
    // 场景一：旧库升级 → 兼容域读到迁移数据，用户域读不到。
    const env = makeEnv();
    const db = env.FOLIA_SYNC_DB;
    await db.prepare("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE themes (fingerprint TEXT PRIMARY KEY, bucket_id INTEGER NOT NULL, theme_json TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE theme_buckets (bucket_id INTEGER PRIMARY KEY, count INTEGER NOT NULL, hash TEXT NOT NULL, updated_at TEXT)").run();
    await db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('visual', ?, '2025-12-01T00:00:00.000Z')")
      .bind(JSON.stringify(settingsBody(1, '2025-12-01T00:00:00.000Z')))
      .run();
    await db.prepare("INSERT INTO themes (fingerprint, bucket_id, theme_json, source, updated_at) VALUES ('fp-legacy', 7, ?, 'manual', '2025-12-01T00:00:00.000Z')")
      .bind(JSON.stringify({ colors: ['legacy'] }))
      .run();

    const migrated = await requestJson(env, '/settings', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(migrated.body.data.visualizerMode, 'bar-1-2025-12-01T00:00:00.000Z');

    const legacyTheme = await postJson(env, '/themes/get', { fingerprints: ['fp-legacy'] }, SYNC_TOKEN);
    assert.equal(legacyTheme.body.themes.length, 1);

    const account = (await registerUser(env, 'fresh@example.com', 'password-123')).body;
    const freshView = await requestJson(env, '/settings', { headers: { Authorization: `Bearer ${account.accessToken}` } });
    assert.equal(freshView.body, null);

    // 场景二：meta 已标记 → 跳过迁移（兼容域清空后不会被旧表复活）。
    const env2 = makeEnv();
    const db2 = env2.FOLIA_SYNC_DB;
    await db2.prepare("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    await db2.prepare("INSERT INTO meta (key, value) VALUES ('migration_v2_done', '1')").run();
    await db2.prepare("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    await db2.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('visual', ?, '2025-12-01T00:00:00.000Z')")
      .bind(JSON.stringify(settingsBody(1, '2025-12-01T00:00:00.000Z')))
      .run();

    const skipped = await requestJson(env2, '/settings', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(skipped.body, null);
  });

  console.log(`\nAll ${envCounter} probe environments passed.`);
};

main().catch((error) => {
  console.error('\n[auth.probe] FAILED:', error);
  process.exit(1);
});
