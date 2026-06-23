import 'dotenv/config';
import { prisma } from './prisma';

/**
 * Maintenance worker.
 *
 * VPN jobs (client create/revoke, node install) are executed by the on-host
 * Agent, which polls the database via its heartbeat — there is no BullMQ job
 * processing here. This process performs the time-based bookkeeping that the
 * request/response path cannot do on its own:
 *
 *   1. Stale-node detection  — a node that stops sending heartbeats is flagged
 *      UNHEALTHY so the dashboard reflects reality.
 *   2. Job-timeout reaping    — a RUNNING job whose agent died mid-flight is
 *      failed instead of hanging forever.
 *   3. Client expiry          — ACTIVE clients past their expiry become EXPIRED.
 */

const SWEEP_INTERVAL_MS = Number(process.env.WORKER_SWEEP_INTERVAL_MS ?? 30_000);
const HEARTBEAT_TIMEOUT_MS = Number(process.env.AGENT_HEARTBEAT_TIMEOUT_MS ?? 120_000);
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 30 * 60_000);

async function markStaleNodesUnhealthy(now: number): Promise<number> {
  const threshold = new Date(now - HEARTBEAT_TIMEOUT_MS);
  const { count } = await prisma.node.updateMany({
    where: { status: 'HEALTHY', lastHeartbeatAt: { lt: threshold } },
    data: { status: 'UNHEALTHY' },
  });
  return count;
}

async function reapTimedOutJobs(now: number): Promise<number> {
  const threshold = new Date(now - JOB_TIMEOUT_MS);
  const { count } = await prisma.job.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: threshold } },
    data: { status: 'FAILED', error: 'Job timed out (no completion from agent)', completedAt: new Date(now) },
  });
  return count;
}

async function expireClients(now: number): Promise<number> {
  const { count } = await prisma.vpnClient.updateMany({
    where: { status: 'ACTIVE', expiresAt: { not: null, lt: new Date(now) } },
    data: { status: 'EXPIRED' },
  });
  return count;
}

async function sweep(): Promise<void> {
  const now = Date.now();
  try {
    const [staleNodes, timedOutJobs, expiredClients] = await Promise.all([
      markStaleNodesUnhealthy(now),
      reapTimedOutJobs(now),
      expireClients(now),
    ]);
    if (staleNodes || timedOutJobs || expiredClients) {
      console.log(
        `[maintenance] nodes→UNHEALTHY: ${staleNodes}, jobs→FAILED: ${timedOutJobs}, clients→EXPIRED: ${expiredClients}`,
      );
    }
  } catch (error) {
    // Never let a transient DB error kill the loop.
    console.error('[maintenance] sweep failed:', error instanceof Error ? error.message : error);
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let shuttingDown = false;

async function main() {
  console.log(
    `Maintenance worker started (sweep ${SWEEP_INTERVAL_MS}ms, heartbeat timeout ${HEARTBEAT_TIMEOUT_MS}ms, job timeout ${JOB_TIMEOUT_MS}ms)`,
  );
  await sweep();
  timer = setInterval(sweep, SWEEP_INTERVAL_MS);
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);
  if (timer) clearInterval(timer);
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
