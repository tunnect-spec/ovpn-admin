import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listJobsSchema } from '@ovpn/api';
import { withAuth } from '@/lib/middleware';

// GET /api/jobs - List jobs
export const GET = withAuth(async (request: NextRequest, payload) => {
  try {
    const { searchParams } = new URL(request.url);
    const input = listJobsSchema.parse(Object.fromEntries(searchParams));

    const where: any = {};
    if (input.nodeId) where.nodeId = input.nodeId;
    if (input.type) where.type = input.type;
    if (input.status) where.status = input.status;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          node: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.job.count({ where }),
    ]);

    return NextResponse.json({
      jobs: jobs.map((j: any) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        nodeId: j.nodeId,
        nodeName: j.node.name,
        payload: j.payload,
        result: j.result,
        error: j.error,
        createdAt: j.createdAt.toISOString(),
        startedAt: j.startedAt?.toISOString() ?? null,
        completedAt: j.completedAt?.toISOString() ?? null,
      })),
      total,
    });
  } catch (error) {
    if (error instanceof Error && 'name' in error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'INVALID_INPUT', issues: error },
        { status: 400 },
      );
    }
    console.error('List jobs error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to list jobs' },
      { status: 500 },
    );
  }
});
