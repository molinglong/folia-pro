import assert from 'node:assert/strict';
import app from '../src/app.js';
import { createAuthRouter } from '../src/auth.js';
import { D1Emulator } from '../src/d1-emulator.js';
import type { Env } from '../src/app.js';
import { MAX_AVATAR_LENGTH } from '../src/profile.js';

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

const patchJson = (env: Env, path: string, payload: unknown, token?: string) => (
  requestJson(env, path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
);

// 1×1 透明 PNG，够过 data URL 校验。
const AVATAR_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

  await section('账号头像：写入 / 读回 / 跨用户隔离 / 兼容模式拒绝', async () => {
    const env = makeEnv();
    const userA = (await registerUser(env, 'avatar-a@example.com', 'password-123')).body;
    const userB = (await registerUser(env, 'avatar-b@example.com', 'password-456')).body;
    const authA = { Authorization: `Bearer ${userA.accessToken}` };
    const authB = { Authorization: `Bearer ${userB.accessToken}` };

    const empty = await requestJson(env, '/account/profile', { headers: authA });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.email, 'avatar-a@example.com');
    assert.equal(empty.body.avatar, null);

    const patched = await patchJson(env, '/account/profile', { avatar: AVATAR_DATA_URL }, userA.accessToken);
    assert.equal(patched.status, 200);
    assert.equal(patched.body.avatar, AVATAR_DATA_URL);

    const readBack = await requestJson(env, '/account/profile', { headers: authA });
    assert.equal(readBack.body.avatar, AVATAR_DATA_URL);

    // 另一个账号读不到这张头像（按 user_id 隔离）。
    const otherUser = await requestJson(env, '/account/profile', { headers: authB });
    assert.equal(otherUser.body.avatar, null);

    const compat = await requestJson(env, '/account/profile', { headers: { Authorization: `Bearer ${SYNC_TOKEN}` } });
    assert.equal(compat.status, 403);
    assert.equal(compat.body.error, 'account_required');

    const notImage = await patchJson(env, '/account/profile', { avatar: 'data:text/plain;base64,aGk=' }, userA.accessToken);
    assert.equal(notImage.status, 400);

    const tooLong = await patchJson(env, '/account/profile', { avatar: `data:image/png;base64,${'A'.repeat(MAX_AVATAR_LENGTH)}` }, userA.accessToken);
    assert.equal(tooLong.status, 400);

    const missingField = await patchJson(env, '/account/profile', {}, userA.accessToken);
    assert.equal(missingField.status, 400);

    const removed = await patchJson(env, '/account/profile', { avatar: null }, userA.accessToken);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.avatar, null);
    const afterRemove = await requestJson(env, '/account/profile', { headers: authA });
    assert.equal(afterRemove.body.avatar, null);
  });

  await section('listening-plays：增量游标、去重、删除墓碑、清空水位与账号隔离', async () => {
    const env = makeEnv();
    const userA = (await registerUser(env, 'listen-a@example.com', 'password-123')).body;
    const userB = (await registerUser(env, 'listen-b@example.com', 'password-456')).body;
    const headersA = { Authorization: `Bearer ${userA.accessToken}` };

    const play = (sessionId: string, playedAt: number) => ({
      sessionId,
      songKey: 'online:netease:1',
      source: 'netease',
      title: 'Night Drive',
      artist: 'Aria',
      album: 'Neon',
      durationSec: 200,
      listenedSec: 120,
      startedAt: playedAt,
      playedAt,
      completed: false,
    });

    const push1 = await postJson(env, '/listening-plays', {
      schemaVersion: 1,
      plays: [play('s1', 1_000), play('s2', 2_000)],
    }, userA.accessToken);
    assert.equal(push1.status, 200);
    assert.equal(push1.body.savedPlays, 2);
    assert.ok(push1.body.revision >= 2);

    const pull1 = await requestJson(env, '/listening-plays?since=0&limit=10', { headers: headersA });
    assert.equal(pull1.status, 200);
    assert.equal(pull1.body.schemaVersion, 1);
    assert.deepEqual(pull1.body.plays.map((record: { sessionId: string }) => record.sessionId), ['s1', 's2']);
    assert.deepEqual(pull1.body.deletes, []);
    assert.equal(pull1.body.hasMore, false);
    assert.equal(pull1.body.reset, false);

    const cursor = pull1.body.since;
    const pullNoop = await requestJson(env, `/listening-plays?since=${cursor}&limit=10`, { headers: headersA });
    assert.equal(pullNoop.body.plays.length, 0);

    // 同一 sessionId 重复推送只更新一条，不产生第二行；全量拉取仍是两条。
    await postJson(env, '/listening-plays', { schemaVersion: 1, plays: [play('s1', 1_000)] }, userA.accessToken);
    const pullAfterDuplicate = await requestJson(env, `/listening-plays?since=${cursor}&limit=10`, { headers: headersA });
    assert.equal(pullAfterDuplicate.body.plays.length, 1);
    const pullAll = await requestJson(env, '/listening-plays?since=0&limit=10', { headers: headersA });
    assert.equal(pullAll.body.plays.length, 2);

    // 删除墓碑跨设备传播；之后重复上传同一个 sessionId 不能复活它。
    const deleted = await postJson(env, '/listening-plays', { schemaVersion: 1, deletes: ['s1'] }, userA.accessToken);
    assert.equal(deleted.status, 200);
    const pullDeleted = await requestJson(env, `/listening-plays?since=${pullAll.body.since}&limit=10`, { headers: headersA });
    assert.deepEqual(pullDeleted.body.deletes, ['s1']);
    await postJson(env, '/listening-plays', { schemaVersion: 1, plays: [play('s1', 1_000)] }, userA.accessToken);
    const pullAfterResurrect = await requestJson(env, '/listening-plays?since=0&limit=10', { headers: headersA });
    assert.deepEqual(pullAfterResurrect.body.plays.map((record: { sessionId: string }) => record.sessionId), ['s2']);

    // 清空水位线：早于 clearedAt 的记录不再下发，晚于它的记录保留；早于水位的推送直接丢弃。
    await postJson(env, '/listening-plays', { schemaVersion: 1, plays: [play('s3', 3_000)] }, userA.accessToken);
    const cleared = await postJson(env, '/listening-plays', {
      schemaVersion: 1,
      clear: { clearedAt: 2_500 },
    }, userA.accessToken);
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.clearedAt, 2_500);
    const pullAfterClear = await requestJson(env, '/listening-plays?since=0&limit=10', { headers: headersA });
    assert.equal(pullAfterClear.body.clearedAt, 2_500);
    assert.deepEqual(pullAfterClear.body.plays.map((record: { sessionId: string }) => record.sessionId), ['s3']);
    // 清空只回收水位线之前的记录，墓碑必须留着，否则不认识的设备重推已删记录会复活它。
    assert.deepEqual(pullAfterClear.body.deletes, ['s1']);
    const pushBeforeClear = await postJson(env, '/listening-plays', {
      schemaVersion: 1,
      plays: [play('s4', 1_000)],
    }, userA.accessToken);
    assert.equal(pushBeforeClear.body.savedPlays, 0);
    const pullAfterOldPush = await requestJson(env, '/listening-plays?since=0&limit=10', { headers: headersA });
    assert.deepEqual(pullAfterOldPush.body.plays.map((record: { sessionId: string }) => record.sessionId), ['s3']);

    // 水位线之上被删的记录：墓碑同样挡住重复上传。
    await postJson(env, '/listening-plays', { schemaVersion: 1, plays: [play('s5', 7_000)] }, userA.accessToken);
    await postJson(env, '/listening-plays', { schemaVersion: 1, deletes: ['s5'] }, userA.accessToken);
    await postJson(env, '/listening-plays', { schemaVersion: 1, plays: [play('s5', 7_000)] }, userA.accessToken);
    const pullAfterLateDelete = await requestJson(env, '/listening-plays?since=0&limit=10', { headers: headersA });
    assert.equal(
      pullAfterLateDelete.body.plays.some((record: { sessionId: string }) => record.sessionId === 's5'),
      false,
    );

    // 分页用干净账号单独测：limit=2 时 hasMore 为 true，游标只推进到本页最后一条。
    const userC = (await registerUser(env, 'listen-c@example.com', 'password-789')).body;
    const headersC = { Authorization: `Bearer ${userC.accessToken}` };
    await postJson(env, '/listening-plays', {
      schemaVersion: 1,
      plays: [play('p1', 10_000), play('p2', 11_000), play('p3', 12_000)],
    }, userC.accessToken);
    const page1 = await requestJson(env, '/listening-plays?since=0&limit=2', { headers: headersC });
    assert.equal(page1.body.hasMore, true);
    assert.equal(page1.body.plays.length, 2);
    const page2 = await requestJson(env, `/listening-plays?since=${page1.body.since}&limit=10`, { headers: headersC });
    assert.equal(page2.body.hasMore, false);
    assert.equal(page2.body.plays.length, 1);

    // 服务端 revision 回退（例如换库）时通知客户端从 0 重拉。
    const reset = await requestJson(env, '/listening-plays?since=999999&limit=10', { headers: headersA });
    assert.equal(reset.body.reset, true);
    assert.equal(reset.body.since, 0);

    // 跨账号隔离 + 兼容模式拒绝 + 非法载荷拒绝。
    const otherUser = await requestJson(env, '/listening-plays?since=0', { headers: { Authorization: `Bearer ${userB.accessToken}` } });
    assert.equal(otherUser.body.plays.length, 0);
    assert.equal(otherUser.body.clearedAt, 0);
    const compat = await postJson(env, '/listening-plays', { schemaVersion: 1, plays: [play('s9', 9_000)] }, SYNC_TOKEN);
    assert.equal(compat.status, 403);
    const invalidSource = await postJson(env, '/listening-plays', {
      schemaVersion: 1,
      plays: [{ ...play('s9', 9_000), source: 'bilibili' }],
    }, userA.accessToken);
    assert.equal(invalidSource.status, 400);
    const mixedClear = await postJson(env, '/listening-plays', {
      schemaVersion: 1,
      plays: [play('s9', 9_000)],
      clear: { clearedAt: 9_000 },
    }, userA.accessToken);
    assert.equal(mixedClear.status, 400);
  });

  await section('CORS 预检放行 DELETE（platform-sessions 远端清除，实机日志曾报 remote clear failed）', async () => {
    const env = makeEnv();
    const preflight = await app.request('/platform-sessions/qq', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'DELETE',
      },
    }, env);
    assert.equal(preflight.status, 204);
    const allowMethods = preflight.headers.get('access-control-allow-methods') ?? '';
    assert.ok(
      allowMethods.split(',').map(method => method.trim().toUpperCase()).includes('DELETE'),
      `DELETE 应在 Access-Control-Allow-Methods 中，实际为 "${allowMethods}"`,
    );
  });

  console.log(`\nAll ${envCounter} probe environments passed.`);
};

main().catch((error) => {
  console.error('\n[auth.probe] FAILED:', error);
  process.exit(1);
});
