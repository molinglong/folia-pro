import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { COMPAT_SCOPE, digestEquals, resolveIdentity, sha256Hex } from './identity.js';
import { clearFailures, isRateLimited, recordFailure } from './rateLimit.js';
import type { SyncEnv } from './app.js';

// src/auth.ts
// 账号体系（Node/Docker 形态专属）：scrypt 密码哈希 + 随机 session token。
// Workers 运行时没有 node:crypto，本文件只能被 node.ts 挂载，
// 绝不能进入 app.ts / cloudflare.ts 的依赖图（见 docs/account-sync-design.md §9）。

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
// better-sqlite3 同进程内存受限时 scrypt 默认 maxmem(32MB) 恰好不够，按参数上界放宽一倍。
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_MAX_LENGTH = 254;

const ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_RATE_LIMIT = 5;
const REGISTER_RATE_WINDOW_MS = 60 * 60 * 1000;

const DEVICE_LABEL_MAX_LENGTH = 120;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

const hashPassword = (password: string) => {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
};

const verifyPassword = (password: string, stored: string) => {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  try {
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const derived = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: SCRYPT_MAXMEM });
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const parseCredentials = (body: Record<string, unknown> | null) => {
  if (!body) return null;
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX_LENGTH) return null;
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return null;
  return { email, password };
};

const parseDeviceLabel = (body: Record<string, unknown> | null) => {
  const label = typeof body?.deviceLabel === 'string' ? body.deviceLabel.trim() : '';
  return label.slice(0, DEVICE_LABEL_MAX_LENGTH) || null;
};

const getClientIp = (c: { req: { header: (name: string) => string | undefined } }) => {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return c.req.header('x-real-ip')?.trim() || 'unknown';
};

const issueSession = async (db: SyncEnv['Bindings']['FOLIA_SYNC_DB'], userId: string, deviceLabel: string | null): Promise<IssuedSession> => {
  const accessToken = randomBytes(32).toString('hex');
  const refreshToken = randomBytes(64).toString('hex');
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TTL_MS).toISOString();
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS).toISOString();
  await db
    .prepare(`
      INSERT INTO sessions (refresh_hash, user_id, access_hash, device_label, created_at, access_expires_at, refresh_expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      await sha256Hex(refreshToken),
      userId,
      await sha256Hex(accessToken),
      deviceLabel,
      now.toISOString(),
      accessExpiresAt,
      refreshExpiresAt,
      now.toISOString(),
    )
    .run();
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
};

const sessionResponse = (userId: string, email: string, session: IssuedSession) => ({
  ok: true,
  userId,
  email,
  ...session,
});

export const createAuthRouter = () => {
  const auth = new Hono<SyncEnv>();

  auth.post('/auth/register', async (c) => {
    if (c.env.ALLOW_REGISTER === 'false') {
      return c.json({ ok: false, error: 'registration_disabled' }, 403);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const ip = getClientIp(c);
    if (isRateLimited(`register:${ip}`, REGISTER_RATE_LIMIT, REGISTER_RATE_WINDOW_MS)) {
      return c.json({ ok: false, error: 'rate_limited' }, 429);
    }
    const credentials = parseCredentials(body);
    if (!credentials) {
      recordFailure(`register:${ip}`, REGISTER_RATE_WINDOW_MS);
      return c.json({ ok: false, error: 'invalid_credentials' }, 400);
    }

    const existing = await c.env.FOLIA_SYNC_DB
      .prepare('SELECT user_id FROM users WHERE email = ?')
      .bind(credentials.email)
      .first<{ user_id: string }>();
    if (existing) {
      return c.json({ ok: false, error: 'email_taken' }, 409);
    }

    const userId = randomUUID();
    const now = new Date().toISOString();
    try {
      await c.env.FOLIA_SYNC_DB
        .prepare('INSERT INTO users (user_id, email, email_verified, password_hash, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
        .bind(userId, credentials.email, hashPassword(credentials.password), now, now)
        .run();
    } catch {
      // 并发注册撞 UNIQUE 的兜底。
      return c.json({ ok: false, error: 'email_taken' }, 409);
    }

    const session = await issueSession(c.env.FOLIA_SYNC_DB, userId, parseDeviceLabel(body));
    return c.json(sessionResponse(userId, credentials.email, session), 201);
  });

  auth.post('/auth/login', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
    const rateKey = `login:${getClientIp(c)}:${email}`;
    if (isRateLimited(rateKey, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS)) {
      return c.json({ ok: false, error: 'rate_limited' }, 429);
    }

    const credentials = parseCredentials(body);
    const userRow = credentials
      ? await c.env.FOLIA_SYNC_DB
        .prepare('SELECT user_id, password_hash FROM users WHERE email = ?')
        .bind(credentials.email)
        .first<{ user_id: string; password_hash: string }>()
      : null;
    // 未知邮箱与错误密码返回同一错误，不泄露邮箱是否已注册。
    if (!credentials || !userRow || !verifyPassword(credentials.password, userRow.password_hash)) {
      recordFailure(rateKey, LOGIN_RATE_WINDOW_MS);
      return c.json({ ok: false, error: 'invalid_credentials' }, 401);
    }

    clearFailures(rateKey);
    const session = await issueSession(c.env.FOLIA_SYNC_DB, userRow.user_id, parseDeviceLabel(body));
    return c.json(sessionResponse(userRow.user_id, credentials.email, session));
  });

  auth.post('/auth/refresh', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (typeof body?.refreshToken !== 'string' || !body.refreshToken) {
      return c.json({ ok: false, error: 'invalid_refresh_token' }, 400);
    }

    const refreshHash = await sha256Hex(body.refreshToken);
    const sessionRow = await c.env.FOLIA_SYNC_DB
      .prepare('SELECT user_id, refresh_expires_at FROM sessions WHERE refresh_hash = ?')
      .bind(refreshHash)
      .first<{ user_id: string; refresh_expires_at: string }>();
    if (!sessionRow || sessionRow.refresh_expires_at <= new Date().toISOString()) {
      return c.json({ ok: false, error: 'invalid_refresh_token' }, 401);
    }

    // 旋转：旧 refresh 立即作废，被盗令牌窗口只有一次。
    await c.env.FOLIA_SYNC_DB
      .prepare('DELETE FROM sessions WHERE refresh_hash = ?')
      .bind(refreshHash)
      .run();
    const session = await issueSession(c.env.FOLIA_SYNC_DB, sessionRow.user_id, parseDeviceLabel(body));
    return c.json({ ok: true, userId: sessionRow.user_id, ...session });
  });

  auth.post('/auth/logout', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (typeof body?.refreshToken !== 'string' || !body.refreshToken) {
      return c.json({ ok: false, error: 'invalid_refresh_token' }, 400);
    }

    await c.env.FOLIA_SYNC_DB
      .prepare('DELETE FROM sessions WHERE refresh_hash = ?')
      .bind(await sha256Hex(body.refreshToken))
      .run();
    return c.json({ ok: true });
  });

  auth.get('/auth/me', resolveIdentity, async (c) => {
    const scopeId = c.get('scopeId');
    if (scopeId === COMPAT_SCOPE) {
      return c.json({ ok: false, error: 'account_required' }, 403);
    }
    const userRow = await c.env.FOLIA_SYNC_DB
      .prepare('SELECT user_id, email, email_verified, created_at FROM users WHERE user_id = ?')
      .bind(scopeId)
      .first<{ user_id: string; email: string; email_verified: number; created_at: string }>();
    if (!userRow) {
      return c.json({ ok: false, error: 'user_not_found' }, 401);
    }
    return c.json({
      ok: true,
      userId: userRow.user_id,
      email: userRow.email,
      emailVerified: userRow.email_verified === 1,
      createdAt: userRow.created_at,
    });
  });

  // 私有部署关闭注册后的手动建号通道（DASHBOARD_TOKEN 鉴权；未配置时路由隐藏）。
  auth.post('/admin/users', async (c) => {
    const dashboardToken = c.env.DASHBOARD_TOKEN;
    const header = c.req.header('Authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!dashboardToken || !presented || !digestEquals(await sha256Hex(presented), await sha256Hex(dashboardToken))) {
      return c.text('Not Found', 404);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const credentials = parseCredentials(body);
    if (!credentials) {
      return c.json({ ok: false, error: 'invalid_credentials' }, 400);
    }
    const existing = await c.env.FOLIA_SYNC_DB
      .prepare('SELECT user_id FROM users WHERE email = ?')
      .bind(credentials.email)
      .first<{ user_id: string }>();
    if (existing) {
      return c.json({ ok: false, error: 'email_taken' }, 409);
    }

    const userId = randomUUID();
    const now = new Date().toISOString();
    try {
      await c.env.FOLIA_SYNC_DB
        .prepare('INSERT INTO users (user_id, email, email_verified, password_hash, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
        .bind(userId, credentials.email, hashPassword(credentials.password), now, now)
        .run();
    } catch {
      return c.json({ ok: false, error: 'email_taken' }, 409);
    }
    return c.json({ ok: true, userId, email: credentials.email }, 201);
  });

  return auth;
};
