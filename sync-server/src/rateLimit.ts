// src/rateLimit.ts
// 内存滑动窗口限速，防公网爆破登录/注册。
// 已知局限：重启即清零、多实例不共享 —— 公网部署建议在反代层（Caddy/Nginx）再叠一层限速（见 README）。

const failureTimestamps = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 4096;

const sweepExpired = (now: number, windowMs: number) => {
  for (const [key, timestamps] of failureTimestamps) {
    const alive = timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (alive.length === 0) {
      failureTimestamps.delete(key);
    } else {
      failureTimestamps.set(key, alive);
    }
  }
};

export const isRateLimited = (key: string, limit: number, windowMs: number) => {
  const now = Date.now();
  const alive = (failureTimestamps.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (alive.length > 0) {
    failureTimestamps.set(key, alive);
  }
  return alive.length >= limit;
};

export const recordFailure = (key: string, windowMs: number) => {
  const now = Date.now();
  const alive = (failureTimestamps.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  alive.push(now);
  failureTimestamps.set(key, alive);
  if (failureTimestamps.size > MAX_TRACKED_KEYS) {
    sweepExpired(now, windowMs);
  }
};

export const clearFailures = (key: string) => {
  failureTimestamps.delete(key);
};
