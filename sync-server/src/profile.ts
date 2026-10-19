import { Hono } from 'hono';
import { COMPAT_SCOPE } from './identity.js';
import type { D1Database, SyncEnv } from './app.js';

// src/profile.ts
// 账号资料（目前只有头像）：走统一身份解析（session access token → scopeId），与其它按用户同步域一致；
// 兼容模式（全局 SYNC_TOKEN）没有账号，明确拒绝而不是静默混入兼容域。
// 头像存 data URL（前端已裁成方形、压到 192px），不落文件系统：Docker 卷里只有 SQLite 一份数据，
// 换设备登录走同一条读取路径。

/** data URL 字符串上限；前端压缩后通常 5–20KB，这里只防滥用。 */
export const MAX_AVATAR_LENGTH = 200_000;

const AVATAR_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

type UserProfileRow = {
  user_id: string;
  email: string;
  avatar: string | null;
  updated_at: string;
};

const loadProfile = (db: D1Database, userId: string) => (
  db
    .prepare('SELECT user_id, email, avatar, updated_at FROM users WHERE user_id = ?')
    .bind(userId)
    .first<UserProfileRow>()
);

const profileResponse = (row: UserProfileRow) => ({
  ok: true,
  userId: row.user_id,
  email: row.email,
  avatar: row.avatar,
  updatedAt: row.updated_at,
});

export const createProfileRouter = () => {
  const profile = new Hono<SyncEnv>();

  profile.get('/account/profile', async (c) => {
    const scopeId = c.get('scopeId');
    if (scopeId === COMPAT_SCOPE) {
      return c.json({ ok: false, error: 'account_required' }, 403);
    }
    const row = await loadProfile(c.env.FOLIA_SYNC_DB, scopeId);
    if (!row) {
      return c.json({ ok: false, error: 'user_not_found' }, 401);
    }
    return c.json(profileResponse(row));
  });

  profile.patch('/account/profile', async (c) => {
    const scopeId = c.get('scopeId');
    if (scopeId === COMPAT_SCOPE) {
      return c.json({ ok: false, error: 'account_required' }, 403);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || !('avatar' in body)) {
      return c.json({ ok: false, error: 'invalid_profile' }, 400);
    }

    const raw = body.avatar;
    let avatar: string | null;
    if (raw === null || raw === '') {
      // 显式空值 = 移除头像，退回首字母占位。
      avatar = null;
    } else if (typeof raw === 'string' && raw.length <= MAX_AVATAR_LENGTH && AVATAR_DATA_URL_PATTERN.test(raw)) {
      avatar = raw;
    } else {
      return c.json({ ok: false, error: 'invalid_avatar' }, 400);
    }

    const row = await loadProfile(c.env.FOLIA_SYNC_DB, scopeId);
    if (!row) {
      return c.json({ ok: false, error: 'user_not_found' }, 401);
    }

    const now = new Date().toISOString();
    await c.env.FOLIA_SYNC_DB
      .prepare('UPDATE users SET avatar = ?, updated_at = ? WHERE user_id = ?')
      .bind(avatar, now, scopeId)
      .run();
    return c.json({ ...profileResponse(row), avatar, updatedAt: now });
  });

  return profile;
};
