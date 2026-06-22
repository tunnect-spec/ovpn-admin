import { Job } from 'bullmq';
import { prisma } from '@ovpn/db';

export interface ClientRevokeJobData {
  jobId: string;
}

export async function processClientRevokeJob(job: Job<ClientRevokeJobData>) {
  const { jobId } = job.data;

  // Get job record
  const jobRecord = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!jobRecord) {
    throw new Error('Job not found');
  }

  const { clientId } = jobRecord.payload as { clientId: string };

  // The worker should no longer process node-specific jobs.
  // These jobs are processed by the Agent polling the database.
  // If we reach here, it means a job was accidentally enqueued to BullMQ.
  throw new Error('CLIENT_REVOKE jobs should be processed by the Agent, not the Worker.');
}
