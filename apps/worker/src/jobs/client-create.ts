import { Job } from 'bullmq';
import { prisma } from '@ovpn/db';
import { callAgentApi } from '@/lib/agent';

export interface ClientCreateJobData {
  jobId: string;
}

export async function processClientCreateJob(job: Job<ClientCreateJobData>) {
  const { jobId } = job.data;

  // Get job record
  const jobRecord = await prisma.job.findUnique({
    where: { id: jobId },
    include: { node: true },
  });

  if (!jobRecord) {
    throw new Error('Job not found');
  }

  const { clientId, clientName } = jobRecord.payload as { clientId: string; clientName: string };
  const node = jobRecord.node;

  if (node.status !== 'HEALTHY') {
    throw new Error('Node is not healthy');
  }

  // The worker should no longer process node-specific jobs.
  // These jobs are processed by the Agent polling the database.
  // If we reach here, it means a job was accidentally enqueued to BullMQ.
  throw new Error('CLIENT_CREATE jobs should be processed by the Agent, not the Worker.');
}
