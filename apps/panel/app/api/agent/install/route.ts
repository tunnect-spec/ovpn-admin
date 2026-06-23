import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateAgent, agentUnauthorized } from '@/lib/api-helpers';

// POST /api/agent/install - Agent reports install completion
export async function POST(request: NextRequest) {
  try {
    const nodeId = await authenticateAgent(request);
    if (!nodeId) return agentUnauthorized();

    const body = await request.json();
    const { success, version, xorMask } = body;

    if (!success) {
      // Update node to error state
      await prisma.node.update({
        where: { id: nodeId },
        data: { status: 'ERROR' },
      });

      return NextResponse.json({ success: true });
    }

    // Update node with install info
    await prisma.node.update({
      where: { id: nodeId },
      data: {
        status: 'HEALTHY',
        openvpnVersion: version,
        xorMask,
        installedAt: new Date(),
      },
    });

    // Update job if exists
    const job = await prisma.job.findFirst({
      where: {
        nodeId,
        type: 'NODE_INSTALL',
        status: 'RUNNING',
      },
    });

    if (job) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          result: { version, xorMask },
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Agent install error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Install update failed' },
      { status: 500 },
    );
  }
}
