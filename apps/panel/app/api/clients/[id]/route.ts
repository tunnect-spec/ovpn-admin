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

// DELETE /api/clients/:id - Revoke client
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

    if (client.status === 'REVOKED') {
      return NextResponse.json(
        { error: 'ALREADY_REVOKED', message: 'Client already revoked' },
        { status: 409 },
      );
    }

    if (client.node.status !== 'HEALTHY') {
      return NextResponse.json(
        { error: 'AGENT_OFFLINE', message: 'Node is not healthy. Cannot revoke client.' },
        { status: 503 },
      );
    }

    // Create revoke job
    const job = await prisma.job.create({
      data: {
        type: 'CLIENT_REVOKE',
        status: 'PENDING',
        priority: 8,
        nodeId: client.nodeId,
        payload: {
          clientId: client.id,
          clientName: client.name,
        },
        maxAttempts: 3,
      },
    });

    // Note: We DO NOT add this to jobQueue anymore.
    // The Agent will pick up the PENDING job via its heartbeat loop.

    // Mark client as revoked (the agent job confirms the on-node CRL update).
    // Stamp revokedAt here: once status flips to REVOKED the job-completion
    // handler no longer touches it (it only acts on ACTIVE clients), so this is
    // the one place that records when the revocation happened.
    await prisma.vpnClient.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    // Expire artifacts
    await prisma.clientArtifact.updateMany({
      where: { clientId: id },
      data: { expiresAt: new Date() },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'client.revoked',
        nodeId: client.nodeId,
        clientId: client.id,
        details: { clientName: client.name },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    return NextResponse.json({
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
      },
    });
  } catch (error) {
    console.error('Revoke client error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to revoke client' },
      { status: 500 },
    );
  }
});
