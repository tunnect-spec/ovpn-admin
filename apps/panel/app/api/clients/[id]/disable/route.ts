import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/middleware';

type Params = Promise<{ id: string }>;

// POST /api/clients/:id/disable — temporarily block a client (reversible).
// The certificate stays valid; a CCD `disable` file on the node blocks it and
// its live session is kicked. Re-enable later via /enable.
export const POST = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const client = await prisma.vpnClient.findUnique({ where: { id }, include: { node: true } });
    if (!client) {
      return NextResponse.json({ error: 'CLIENT_NOT_FOUND', message: 'Client not found' }, { status: 404 });
    }
    if (client.status === 'REVOKED' || client.status === 'EXPIRED') {
      return NextResponse.json(
        { error: 'INVALID_STATE', message: `A ${client.status.toLowerCase()} client cannot be disabled` },
        { status: 409 },
      );
    }
    if (client.status === 'DISABLED') {
      return NextResponse.json({ error: 'ALREADY_DISABLED', message: 'Client is already disabled' }, { status: 409 });
    }

    // Need a connected agent to actually apply the block on the node.
    if (!client.node.lastHeartbeatAt || Date.now() - client.node.lastHeartbeatAt.getTime() > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: 'AGENT_OFFLINE', message: 'Node agent is not connected. Try again when the node is online.' },
        { status: 503 },
      );
    }

    const job = await prisma.job.create({
      data: {
        type: 'CLIENT_DISABLE',
        status: 'PENDING',
        priority: 8,
        nodeId: client.nodeId,
        payload: { clientId: client.id, clientName: client.name },
        maxAttempts: 3,
      },
    });

    await prisma.vpnClient.update({
      where: { id },
      data: { status: 'DISABLED', disabledAt: new Date(), online: false },
    });

    await prisma.auditLog.create({
      data: {
        action: 'client.disabled',
        nodeId: client.nodeId,
        clientId: client.id,
        details: { clientName: client.name },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    return NextResponse.json({ job: { id: job.id, type: job.type, status: job.status } });
  } catch (error) {
    console.error('Disable client error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to disable client' }, { status: 500 });
  }
});
