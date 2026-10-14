import { createMiddleware } from 'hono/factory';
import type { Env, SyncEnv } from './app.js';

// src/identity.ts
// 请求身份解析：全局 SYNC_TOKEN → 兼容模式（scope = ''），用户 session token → scope = user_id。
// 只依赖 WebCrypto（crypto.subtle），保证 Workers / Node 双运行时可用；
// session 的签发在 auth.ts（node:crypto，Node/Docker 形态专属），本文件只做校验。

export const COMPAT_SCOPE = '';

const textEncoder = new TextEncoder();

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

// 输入都是等长 hex 摘要，逐字符异或累积即等价常量时间比较，避免时序侧信道。
export const digestEquals = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
};

export const resolveIdentity = createMiddleware<SyncEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const presentedDigest = await sha256Hex(token);
  if (digestEquals(presentedDigest, await sha256Hex(c.env.SYNC_TOKEN))) {
    // 兼容模式：行为与 schema 1 的单用户全局 Token 完全一致。
    c.set('scopeId', COMPAT_SCOPE);
    await next();
    return;
  }

  const sessionRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT user_id, access_expires_at FROM sessions WHERE access_hash = ?')
    .bind(presentedDigest)
    .first<{ user_id: string; access_expires_at: string }>();
  if (!sessionRow || sessionRow.access_expires_at <= new Date().toISOString()) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  c.set('scopeId', sessionRow.user_id);
  // last_seen_at 尽力而为地刷新，失败不影响本次请求。
  void c.env.FOLIA_SYNC_DB
    .prepare('UPDATE sessions SET last_seen_at = ? WHERE access_hash = ?')
    .bind(new Date().toISOString(), presentedDigest)
    .run()
    .catch(() => undefined);
  await next();
});
