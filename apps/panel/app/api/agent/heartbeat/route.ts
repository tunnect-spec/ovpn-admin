import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { agentHeartbeatSchema } from '@ovpn/api';
import { authenticateAgent, agentUnauthorized, isZodError, zodErrorResponse } from '@/lib/api-helpers';

// POST /api/agent/heartbeat - Agent heartbeat
export async function POST(request: NextRequest) {
  try {
    const nodeId = await authenticateAgent(request);
    if (!nodeId) return agentUnauthorized();

    const body = await request.json();
    const input = agentHeartbeatSchema.parse({ ...body, nodeId });

    // Get node
    const node = await prisma.node.findUnique({
      where: { id: nodeId },
    });

    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    // Determine new status
    let newStatus = node.status;
    if (input.status === 'RUNNING') {
      newStatus = 'HEALTHY';
    } else if (input.status === 'ERROR') {
      newStatus = 'ERROR';
    } else if (node.status === 'PENDING') {
      newStatus = 'PROVISIONING';
    }

    // Update heartbeat
    const now = new Date();
    await prisma.node.update({
      where: { id: nodeId },
      data: {
        lastHeartbeatAt: now,
        status: newStatus,
        installedAt: newStatus === 'HEALTHY' && !node.installedAt ? now : node.installedAt,
      },
    });

    // Store health check. Derive health from the agent-reported status and
    // resource pressure rather than always recording HEALTHY.
    const cpu = input.details?.cpu ?? 0;
    const disk = input.details?.disk ?? 0;
    const healthStatus =
      input.status === 'ERROR' || input.status === 'STOPPED'
        ? 'DOWN'
        : cpu >= 95 || disk >= 95
          ? 'DEGRADED'
          : 'HEALTHY';

    await prisma.healthCheck.create({
      data: {
        nodeId,
        status: healthStatus,
        details: input.details ?? {},
        checkedAt: now,
      },
    });

    // Get pending jobs for this node
    const pendingJobs = await prisma.job.findMany({
      where: {
        nodeId,
        status: 'PENDING',
      },
      orderBy: { priority: 'desc' },
      take: 5,
      select: {
        id: true,
        type: true,
        payload: true,
      },
    });

    // Mark jobs as running
    if (pendingJobs.length > 0) {
      await prisma.job.updateMany({
        where: {
          id: { in: pendingJobs.map((j: any) => j.id) },
        },
        data: {
          status: 'RUNNING',
          startedAt: now,
        },
      });
    }

    return NextResponse.json({
      success: true,
      serverTime: now.toISOString(),
      pendingJobs,
    });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('Heartbeat error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Heartbeat failed' },
      { status: 500 },
    );
  }
}
