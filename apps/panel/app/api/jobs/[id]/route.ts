import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jobQueue } from '@/lib/queue';
import { withAuth } from '@/lib/middleware';

type Params = Promise<{ id: string }>;

// GET /api/jobs/:id - Get job details
export const GET = withAuth(async (request: NextRequest, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        node: {
          select: { id: true, name: true, host: true },
        },
      },
    });

    if (!job) {
      return NextResponse.json(
        { error: 'JOB_NOT_FOUND', message: 'Job not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        nodeId: job.nodeId,
        nodeName: job.node.name,
        payload: job.payload,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      },
    });
  } catch (error) {
    console.error('Get job error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to get job' },
      { status: 500 },
    );
  }
});

// DELETE /api/jobs/:id - Cancel job
export const DELETE = withAuth(async (request: NextRequest, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      return NextResponse.json(
        { error: 'JOB_NOT_FOUND', message: 'Job not found' },
        { status: 404 },
      );
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'JOB_ALREADY_COMPLETED', message: 'Job already completed' },
        { status: 409 },
      );
    }

    // Cancel in BullMQ
    await jobQueue.remove(id);

    // Update status
    await prisma.job.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      job: { id, status: 'CANCELLED' },
    });
  } catch (error) {
    console.error('Cancel job error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to cancel job' },
      { status: 500 },
    );
  }
});
