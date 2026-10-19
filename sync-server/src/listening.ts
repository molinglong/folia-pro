import { Hono } from 'hono';
import { COMPAT_SCOPE } from './identity.js';
import type { D1PreparedStatement, SyncEnv } from './app.js';

// src/listening.ts
// 听歌记录云同步（/listening-plays，独立 schemaVersion 1）。
//
// 记录是只追加的事件：跨设备按 sessionId 取并集，不需要 LWW。删除用 tombstone 传播；
// 清空用每用户 cleared_at 水位线传播（服务端只挡住旧记录，不要求各端逐条删除）。
// revision 是服务端分配的单调游标，客户端只拉 revision > cursor 的增量。

export const MAX_LISTENING_PUSH_PLAYS = 200;
export const MAX_LISTENING_PUSH_DELETES = 500;
export const MAX_LISTENING_PULL_LIMIT = 1000;
export const DEFAULT_LISTENING_PULL_LIMIT = 500;
const MAX_LISTENING_PUSH_JSON_LENGTH = 1_000_000;
const MAX_LISTENING_SESSION_ID_LENGTH = 256;
const MAX_LISTENING_TEXT_LENGTH = 512;
const MAX_LISTENING_COVER_URL_LENGTH = 2_048;
const MAX_LISTENING_PLAY_JSON_LENGTH = 8_192;
const MAX_LISTENING_DURATION_SEC = 7 * 24 * 60 * 60;

const LISTENING_SOURCES: ReadonlySet<string> = new Set([
  'netease', 'qq', 'kugou', 'local', 'navidrome', 'stage',
]);

type ListeningPlayInput = {
  sessionId: string;
  songKey: string;
  source: string;
  title: string;
  artist: string;
  album: string;
  coverUrl?: string;
  durationSec: number;
  listenedSec: number;
  startedAt: number;
  playedAt: number;
  completed: boolean;
};

type ListeningPlayRow = {
  session_id: string;
  played_at: number;
  payload_json: string;
  revision: number;
  deleted: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const isBoundedString = (value: unknown, maxLength: number): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= maxLength
);

const parseListeningPlay = (value: unknown): ListeningPlayInput | null => {
  if (!isRecord(value)
    || Object.keys(value).some((key) => ![
      'sessionId', 'songKey', 'source', 'title', 'artist', 'album', 'coverUrl',
      'durationSec', 'listenedSec', 'startedAt', 'playedAt', 'completed',
    ].includes(key))
  ) {
    return null;
  }

  const { sessionId, songKey, source, title, artist, album, coverUrl } = value;
  if (!isBoundedString(sessionId, MAX_LISTENING_SESSION_ID_LENGTH)
    || !isBoundedString(songKey, MAX_LISTENING_TEXT_LENGTH)
    || typeof source !== 'string'
    || !LISTENING_SOURCES.has(source)
    || !isBoundedString(title, MAX_LISTENING_TEXT_LENGTH)
    || typeof artist !== 'string'
    || artist.length > MAX_LISTENING_TEXT_LENGTH
    || typeof album !== 'string'
    || album.length > MAX_LISTENING_TEXT_LENGTH
    || (coverUrl !== undefined && !isBoundedString(coverUrl, MAX_LISTENING_COVER_URL_LENGTH))
    || (coverUrl !== undefined && !/^https?:\/\//i.test(coverUrl as string))
    || !isFiniteNumber(value.durationSec)
    || value.durationSec < 0
    || value.durationSec > MAX_LISTENING_DURATION_SEC
    || !isFiniteNumber(value.listenedSec)
    || value.listenedSec < 0
    || value.listenedSec > MAX_LISTENING_DURATION_SEC
    || !isFiniteNumber(value.startedAt)
    || value.startedAt <= 0
    || !isFiniteNumber(value.playedAt)
    || value.playedAt <= 0
    || typeof value.completed !== 'boolean'
  ) {
    return null;
  }

  const record: ListeningPlayInput = {
    sessionId,
    songKey,
    source,
    title,
    artist,
    album,
    ...(coverUrl !== undefined ? { coverUrl: coverUrl as string } : {}),
    durationSec: value.durationSec,
    listenedSec: value.listenedSec,
    startedAt: Math.trunc(value.startedAt),
    playedAt: Math.trunc(value.playedAt),
    completed: value.completed,
  };

  // 单条记录也必须受控：字符串各有上限，但组合后的 JSON 再兜一次底。
  return JSON.stringify(record).length <= MAX_LISTENING_PLAY_JSON_LENGTH ? record : null;
};

const parseQueryInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const createListeningRouter = () => {
  const listening = new Hono<SyncEnv>();

  listening.get('/listening-plays', async (c) => {
    const scopeId = c.get('scopeId');
    if (scopeId === COMPAT_SCOPE) {
      return c.json({ ok: false, error: 'account_required' }, 403);
    }

    const db = c.env.FOLIA_SYNC_DB;
    const since = Math.max(0, parseQueryInt(c.req.query('since'), 0));
    const limit = Math.min(
      MAX_LISTENING_PULL_LIMIT,
      Math.max(1, parseQueryInt(c.req.query('limit'), DEFAULT_LISTENING_PULL_LIMIT)),
    );

    const state = await db
      .prepare('SELECT revision, cleared_at FROM listening_sync_state WHERE user_id = ?')
      .bind(scopeId)
      .first<{ revision: number; cleared_at: number }>();
    const latestRevision = Number(state?.revision ?? 0);
    const clearedAt = Number(state?.cleared_at ?? 0);

    // 云端数据库被重建/回滚时，本地游标可能比服务端更大；让客户端回到 0 重拉，别永远空转。
    if (since > latestRevision) {
      return c.json({
        schemaVersion: 1,
        plays: [],
        deletes: [],
        clearedAt,
        since: 0,
        latestRevision,
        hasMore: false,
        reset: true,
      });
    }

    const rows = await db
      .prepare(`
        SELECT session_id, played_at, payload_json, revision, deleted
        FROM listening_plays
        WHERE user_id = ? AND revision > ?
        ORDER BY revision ASC
        LIMIT ?
      `)
      .bind(scopeId, since, limit)
      .all<ListeningPlayRow>();
    const fetched = rows.results ?? [];

    const plays: unknown[] = [];
    const deletes: string[] = [];
    fetched.forEach((row) => {
      if (row.deleted === 1) {
        deletes.push(row.session_id);
        return;
      }
      // 清空水位线之前的记录不再下发；服务端的物理删除只是尽力而为的回收。
      if (Number(row.played_at) <= clearedAt) return;
      try {
        const parsed = JSON.parse(row.payload_json) as unknown;
        if (isRecord(parsed)) plays.push(parsed);
      } catch {
        // 损坏的旧行跳过，不能让一页数据拖垮整次同步。
      }
    });

    const lastRevision = fetched.length > 0
      ? Number(fetched[fetched.length - 1].revision)
      : since;
    const hasMore = fetched.length === limit;
    return c.json({
      schemaVersion: 1,
      plays,
      deletes,
      clearedAt,
      since: hasMore ? lastRevision : Math.max(since, latestRevision),
      latestRevision,
      hasMore,
      reset: false,
    });
  });

  listening.post('/listening-plays', async (c) => {
    const scopeId = c.get('scopeId');
    if (scopeId === COMPAT_SCOPE) {
      return c.json({ ok: false, error: 'account_required' }, 403);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || body.schemaVersion !== 1) {
      return c.json({ ok: false, error: 'invalid_listening_push' }, 400);
    }
    if (JSON.stringify(body).length > MAX_LISTENING_PUSH_JSON_LENGTH) {
      return c.json({ ok: false, error: 'listening_push_too_large' }, 413);
    }

    const rawPlays = Array.isArray(body.plays) ? body.plays : [];
    const rawDeletes = Array.isArray(body.deletes) ? body.deletes : [];
    const rawClear = isRecord(body.clear) ? body.clear : null;
    if (rawPlays.length > MAX_LISTENING_PUSH_PLAYS || rawDeletes.length > MAX_LISTENING_PUSH_DELETES) {
      return c.json({ ok: false, error: 'listening_push_too_large' }, 413);
    }
    // 清空必须单独成批：它的语义是"那一刻之前的记录全不要"，混入新增会让顺序变得含糊。
    if (rawClear && (rawPlays.length > 0 || rawDeletes.length > 0)) {
      return c.json({ ok: false, error: 'clear_must_be_alone' }, 400);
    }

    const db = c.env.FOLIA_SYNC_DB;

    if (rawClear) {
      const requestedClearedAt = rawClear.clearedAt;
      if (!isFiniteNumber(requestedClearedAt) || requestedClearedAt <= 0) {
        return c.json({ ok: false, error: 'invalid_cleared_at' }, 400);
      }
      // 客户端时钟最多信到"现在"：超前时钟不能把其它设备将来的记录一起清掉。
      const clearedAt = Math.min(Math.trunc(requestedClearedAt), Date.now());
      const state = await db
        .prepare(`
          INSERT INTO listening_sync_state (user_id, revision, cleared_at)
          VALUES (?, 1, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            revision = listening_sync_state.revision + 1,
            cleared_at = MAX(listening_sync_state.cleared_at, excluded.cleared_at)
          RETURNING revision, cleared_at
        `)
        .bind(scopeId, clearedAt)
        .first<{ revision: number; cleared_at: number }>();
      const effectiveClearedAt = Number(state?.cleared_at ?? clearedAt);

      // 尽力回收；即使失败，GET 也会按 cleared_at 过滤，数据不会复活。
      // 墓碑必须保留：水位线之上的已删记录若被不认识的设备重推，仍要靠它挡住复活。
      await db
        .prepare('DELETE FROM listening_plays WHERE user_id = ? AND played_at <= ? AND deleted = 0')
        .bind(scopeId, effectiveClearedAt)
        .run()
        .catch(() => undefined);

      console.log(`[Sync] Cleared listening plays (scope: ${scopeId}, clearedAt: ${effectiveClearedAt})`);
      return c.json({
        ok: true,
        schemaVersion: 1,
        revision: Number(state?.revision ?? 0),
        clearedAt: effectiveClearedAt,
        savedPlays: 0,
        savedDeletes: 0,
      });
    }

    const plays: ListeningPlayInput[] = [];
    for (const rawPlay of rawPlays) {
      const parsed = parseListeningPlay(rawPlay);
      if (!parsed) {
        return c.json({ ok: false, error: 'invalid_listening_play' }, 400);
      }
      plays.push(parsed);
    }

    const deletes: string[] = [];
    for (const rawDelete of rawDeletes) {
      if (!isBoundedString(rawDelete, MAX_LISTENING_SESSION_ID_LENGTH)) {
        return c.json({ ok: false, error: 'invalid_listening_delete' }, 400);
      }
      deletes.push(rawDelete);
    }

    const uniquePlays = Array.from(new Map(plays.map(play => [play.sessionId, play])).values());
    const uniqueDeletes = Array.from(new Set(deletes));

    const stateRow = await db
      .prepare('SELECT revision, cleared_at FROM listening_sync_state WHERE user_id = ?')
      .bind(scopeId)
      .first<{ revision: number; cleared_at: number }>();
    const existingClearedAt = Number(stateRow?.cleared_at ?? 0);
    const playsToSave = uniquePlays.filter(play => play.playedAt > existingClearedAt);
    const changeCount = playsToSave.length + uniqueDeletes.length;
    if (changeCount === 0) {
      return c.json({
        ok: true,
        schemaVersion: 1,
        revision: Number(stateRow?.revision ?? 0),
        clearedAt: existingClearedAt,
        savedPlays: 0,
        savedDeletes: 0,
      });
    }

    // 一个语句原子分配一段 revision；并发设备各拿一段，不会重号。
    const allocated = await db
      .prepare(`
        INSERT INTO listening_sync_state (user_id, revision, cleared_at)
        VALUES (?, ?, 0)
        ON CONFLICT(user_id) DO UPDATE SET
          revision = listening_sync_state.revision + excluded.revision
        RETURNING revision
      `)
      .bind(scopeId, changeCount)
      .first<{ revision: number }>();
    const endRevision = Number(allocated?.revision ?? changeCount);
    let revision = endRevision - changeCount;
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];

    playsToSave.forEach((play) => {
      revision += 1;
      statements.push(db
        .prepare(`
          INSERT INTO listening_plays (user_id, session_id, played_at, payload_json, revision, deleted, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)
          ON CONFLICT(user_id, session_id) DO UPDATE SET
            played_at = excluded.played_at,
            payload_json = excluded.payload_json,
            revision = excluded.revision,
            updated_at = excluded.updated_at
          WHERE listening_plays.deleted = 0
        `)
        .bind(scopeId, play.sessionId, play.playedAt, JSON.stringify(play), revision, now));
    });

    uniqueDeletes.forEach((sessionId) => {
      revision += 1;
      statements.push(db
        .prepare(`
          INSERT INTO listening_plays (user_id, session_id, played_at, payload_json, revision, deleted, updated_at)
          VALUES (?, ?, 0, '{}', ?, 1, ?)
          ON CONFLICT(user_id, session_id) DO UPDATE SET
            played_at = 0,
            payload_json = '{}',
            revision = excluded.revision,
            deleted = 1,
            updated_at = excluded.updated_at
        `)
        .bind(scopeId, sessionId, revision, now));
    });

    await db.batch(statements);

    return c.json({
      ok: true,
      schemaVersion: 1,
      revision: endRevision,
      clearedAt: existingClearedAt,
      savedPlays: playsToSave.length,
      savedDeletes: uniqueDeletes.length,
    });
  });

  return listening;
};
