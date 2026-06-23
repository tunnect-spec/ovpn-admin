import { Queue } from 'bullmq';
import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  jobQueue: Queue | undefined;
};

export const connection = globalForRedis.redis ?? new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const jobQueue = globalForRedis.jobQueue ?? new Queue('ovpn-jobs', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000, age: 7 * 24 * 3600 },
    removeOnFail: { count: 5000, age: 30 * 24 * 3600 },
  },
});

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = connection;
  globalForRedis.jobQueue = jobQueue;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await jobQueue.close();
  await connection.quit();
});

process.on('SIGINT', async () => {
  await jobQueue.close();
  await connection.quit();
});
