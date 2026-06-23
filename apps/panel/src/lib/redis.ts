import Redis from 'ioredis';

// A single shared ioredis connection, used for rate limiting (and any other
// lightweight Redis-backed feature). Kept as a module singleton, and reused
// across hot reloads in development.
const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const connection =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

// Avoid an unhandled 'error' event crashing the process if Redis is unreachable.
connection.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = connection;
}
