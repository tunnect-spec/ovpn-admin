import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/middleware';

type Params = Promise<{ id: string }>;

// POST /api/clients/:id/enable — re-enable a previously disabled client.
export const POST = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const client = await prisma.vpnClient.findUnique({ where: { id }, include: { node: true } });
    if (!client) {
      return NextResponse.json({ error: 'CLIENT_NOT_FOUND', message: 'Client not found' }, { status: 404 });
    }
    if (client.status !== 'DISABLED') {
      return NextResponse.json(
        { error: 'INVALID_STATE', message: 'Only a disabled client can be enabled' },
        { status: 409 },
      );
    }

    if (!client.node.lastHeartbeatAt || Date.now() - client.node.lastHeartbeatAt.getTime() > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: 'AGENT_OFFLINE', message: 'Node agent is not connected. Try again when the node is online.' },
        { status: 503 },
      );
    }

    const job = await prisma.job.create({
      data: {
        type: 'CLIENT_ENABLE',
        status: 'PENDING',
        priority: 8,
        nodeId: client.nodeId,
        payload: { clientId: client.id, clientName: client.name },
        maxAttempts: 3,
      },
    });

    await prisma.vpnClient.update({
      where: { id },
      data: { status: 'ACTIVE', disabledAt: null },
    });

    await prisma.auditLog.create({
      data: {
        action: 'client.enabled',
        nodeId: client.nodeId,
        clientId: client.id,
        details: { clientName: client.name },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    return NextResponse.json({ job: { id: job.id, type: job.type, status: job.status } });
  } catch (error) {
    console.error('Enable client error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to enable client' }, { status: 500 });
  }
});
