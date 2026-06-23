import { connection } from '@/lib/redis';

export interface RateLimitOptions {
  /** Maximum number of allowed requests within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Fixed-window rate limiter backed by the shared ioredis connection.
 *
 * Uses INCR + EXPIRE: the counter is incremented atomically and the TTL is set
 * only when the key is first created (INCR returns 1). When the limit is
 * exceeded the remaining TTL is returned as `retryAfterSec`.
 *
 * Fails OPEN: if Redis throws for any reason the request is allowed through so
 * that a Redis outage cannot lock everyone out.
 */
export async function rateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const { limit, windowSec } = opts;
  const redisKey = `ratelimit:${key}`;

  try {
    const count = await connection.incr(redisKey);

    // Only set the expiry when the counter is first created, so the window is
    // anchored to the first request rather than sliding on every hit.
    if (count === 1) {
      await connection.expire(redisKey, windowSec);
    }

    if (count > limit) {
      const ttl = await connection.ttl(redisKey);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: ttl > 0 ? ttl : windowSec,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterSec: 0,
    };
  } catch (error) {
    // Fail open — never block legitimate traffic because of a Redis problem.
    console.error('[rate-limit] Redis error, failing open:', error);
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }
}
