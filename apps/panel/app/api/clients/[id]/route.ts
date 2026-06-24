import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/middleware';

type Params = Promise<{ id: string }>;

// GET /api/clients/:id - Get client details
export const GET = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const client = await prisma.vpnClient.findUnique({
      where: { id },
      include: {
        node: {
          select: { id: true, name: true, host: true },
        },
        artifacts: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!client) {
      return NextResponse.json(
        { error: 'CLIENT_NOT_FOUND', message: 'Client not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      client: {
        id: client.id,
        name: client.name,
        status: client.status,
        fingerprint: client.fingerprint,
        createdAt: client.createdAt.toISOString(),
        revokedAt: client.revokedAt?.toISOString() ?? null,
        expiresAt: client.expiresAt?.toISOString() ?? null,
        lastSeenAt: client.lastSeenAt?.toISOString() ?? null,
        bytesUp: Number(client.bytesUp),
        bytesDown: Number(client.bytesDown),
        online: client.online,
        node: client.node,
        artifact: client.artifacts[0] ?? null,
      },
    });
  } catch (error) {
    console.error('Get client error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to get client' },
      { status: 500 },
    );
  }
});

// DELETE /api/clients/:id - Permanently delete a client.
// Revokes the certificate on the node (so the .ovpn can never reconnect, even
// though the panel record is gone) and removes the client + its artifacts.
export const DELETE = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const client = await prisma.vpnClient.findUnique({
      where: { id },
      include: { node: true },
    });

    if (!client) {
      return NextResponse.json(
        { error: 'CLIENT_NOT_FOUND', message: 'Client not found' },
        { status: 404 },
      );
    }

    // Queue a revoke on the node unless it's already revoked. The agent picks
    // this up via its heartbeat; the job carries the client NAME, so it still
    // works after we delete the DB row below. revoke-user.sh adds the cert to
    // the CRL and clears any CCD/disable override + frees the name for reuse.
    if (client.status !== 'REVOKED') {
      await prisma.job.create({
        data: {
          type: 'CLIENT_REVOKE',
          status: 'PENDING',
          priority: 8,
          nodeId: client.nodeId,
          payload: { clientId: client.id, clientName: client.name },
          maxAttempts: 3,
        },
      });
    }

    // Audit before deletion. AuditLog.clientId is SET NULL on delete, so the
    // record survives (the client name is preserved in details).
    await prisma.auditLog.create({
      data: {
        action: 'client.deleted',
        nodeId: client.nodeId,
        clientId: client.id,
        details: { clientName: client.name },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    // Permanently remove the client and its artifacts (artifacts cascade).
    await prisma.vpnClient.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete client error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to delete client' },
      { status: 500 },
    );
  }
});
