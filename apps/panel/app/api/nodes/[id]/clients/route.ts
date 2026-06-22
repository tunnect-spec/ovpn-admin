import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createClientSchema } from '@ovpn/api';
import { jobQueue } from '@/lib/queue';
import { generateFingerprint } from '@/lib/crypto';
import { withAuth } from '@/lib/middleware';
import type { ClientStatus } from '@ovpn/types';

type Params = Promise<{ id: string }>;

// GET /api/nodes/:id/clients - List clients for a node
export const GET = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id: nodeId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    const where = {
      nodeId,
      ...(status ? { status: status as ClientStatus } : {}),
    };

    const clients = await prisma.vpnClient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { artifacts: true } },
      },
    });

    return NextResponse.json({
      clients: clients.map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        fingerprint: c.fingerprint,
        createdAt: c.createdAt.toISOString(),
        revokedAt: c.revokedAt?.toISOString() ?? null,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
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

// POST /api/nodes/:id/clients - Create new client
export const POST = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id: nodeId } = await params;
    const body = await request.json();
    const input = createClientSchema.parse(body);

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

    // Create client record
    const client = await prisma.vpnClient.create({
      data: {
        nodeId,
        name: input.name,
        status: 'ACTIVE',
        fingerprint: generateFingerprint(),
        expiresAt,
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
    if (error instanceof Error && 'name' in error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'INVALID_INPUT', issues: error },
        { status: 400 },
      );
    }
    console.error('Create client error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to create client' },
      { status: 500 },
    );
  }
});
