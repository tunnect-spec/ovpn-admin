import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createClientSchema } from '@ovpn/api';
import { generateFingerprint } from '@/lib/crypto';
import { withAuth } from '@/lib/middleware';
import { canAccessNode } from '@/lib/access';
import { isZodError, zodErrorResponse } from '@/lib/api-helpers';
import type { ClientStatus } from '@ovpn/types';

type Params = Promise<{ id: string }>;

// GET /api/nodes/:id/clients - List clients for a node (scoped for managers)
export const GET = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id: nodeId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    if (!(await canAccessNode(payload, nodeId))) {
      return NextResponse.json({ error: 'NODE_NOT_FOUND', message: 'Node not found' }, { status: 404 });
    }

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    // Ignore an invalid status filter rather than passing it to Prisma (→ 500).
    const VALID_CLIENT_STATUSES = ['ACTIVE', 'DISABLED', 'REVOKED', 'EXPIRED'];
    const where = {
      nodeId,
      ...(status && VALID_CLIENT_STATUSES.includes(status) ? { status: status as ClientStatus } : {}),
    };

    const clients = await prisma.vpnClient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { artifacts: true } },
        createdBy: { select: { email: true } },
      },
    });

    return NextResponse.json({
      clients: clients.map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        fingerprint: c.fingerprint,
        createdAt: c.createdAt.toISOString(),
        createdByEmail: c.createdBy?.email ?? null,
        revokedAt: c.revokedAt?.toISOString() ?? null,
        disabledAt: c.disabledAt?.toISOString() ?? null,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
        connectedSince: c.connectedSince?.toISOString() ?? null,
        realAddress: c.realAddress ?? null,
        vpnAddress: c.vpnAddress ?? null,
        bytesUp: Number(c.bytesUp),
        bytesDown: Number(c.bytesDown),
        online: c.online,
        artifactCount: c._count.artifacts,
      })),
      total: clients.length,
    });
  } catch (error) {
    console.error('List clients error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to list clients' },
      { status: 500 },
    );
  }
});

// POST /api/nodes/:id/clients - Create new client (managers: only on assigned nodes)
export const POST = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id: nodeId } = await params;
    const body = await request.json();
    const input = createClientSchema.parse(body);

    if (!(await canAccessNode(payload, nodeId))) {
      return NextResponse.json({ error: 'NODE_NOT_FOUND', message: 'Node not found' }, { status: 404 });
    }

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    if (node.status !== 'HEALTHY') {
      return NextResponse.json(
        { error: 'AGENT_OFFLINE', message: 'Node is not healthy. Cannot create client.' },
        { status: 503 },
      );
    }

    // Check for duplicate client name
    const existing = await prisma.vpnClient.findUnique({
      where: { nodeId_name: { nodeId, name: input.name } },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'CLIENT_ALREADY_EXISTS', message: 'Client with this name already exists' },
        { status: 409 },
      );
    }

    // Calculate expiration
    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 24 * 60 * 60 * 1000)
      : null;

    // Create client record (track who created it — admin or manager)
    const client = await prisma.vpnClient.create({
      data: {
        nodeId,
        name: input.name,
        status: 'ACTIVE',
        fingerprint: generateFingerprint(),
        expiresAt,
        createdById: payload.sub,
      },
    });

    // Create job
    const job = await prisma.job.create({
      data: {
        type: 'CLIENT_CREATE',
        status: 'PENDING',
        priority: 5,
        nodeId,
        payload: {
          clientId: client.id,
          clientName: input.name,
          // Issue the cert with the chosen validity so it genuinely stops working
          // on the expiry date (not just a panel label). null = no expiry.
          expiresInDays: input.expiresIn ?? null,
        },
        maxAttempts: 3,
      },
    });

    // Note: We DO NOT add this to jobQueue anymore.
    // The Agent will pick up the PENDING job via its heartbeat loop.

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'client.created',
        nodeId,
        clientId: client.id,
        details: { clientName: input.name },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    return NextResponse.json({
      client: {
        id: client.id,
        name: client.name,
        status: client.status,
      },
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
      },
    }, { status: 201 });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('Create client error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to create client' },
      { status: 500 },
    );
  }
});
