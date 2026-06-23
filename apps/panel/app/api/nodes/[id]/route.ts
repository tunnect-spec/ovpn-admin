import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updateNodeSchema } from '@ovpn/api';
import { withAuth } from '@/lib/middleware';
import { isZodError, zodErrorResponse } from '@/lib/api-helpers';

type Params = Promise<{ id: string }>;

// GET /api/nodes/:id - Get node details
export const GET = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const node = await prisma.node.findUnique({
      where: { id },
      include: {
        healthChecks: {
          orderBy: { checkedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    const healthStatus = node.healthChecks[0] ?? null;

    return NextResponse.json({
      node: {
        id: node.id,
        name: node.name,
        host: node.host,
        port: node.port,
        status: node.status,
        version: node.version,
        openvpnVersion: node.openvpnVersion,
        xorMask: node.xorMask,
        lastHeartbeatAt: node.lastHeartbeatAt?.toISOString() ?? null,
        installedAt: node.installedAt?.toISOString() ?? null,
        createdAt: node.createdAt.toISOString(),
        updatedAt: node.updatedAt.toISOString(),
        metadata: node.metadata,
        healthStatus: healthStatus ? {
          status: healthStatus.status,
          details: healthStatus.details,
          checkedAt: healthStatus.checkedAt.toISOString(),
        } : null,
      },
    });
  } catch (error) {
    console.error('Get node error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to get node' },
      { status: 500 },
    );
  }
});

// PATCH /api/nodes/:id - Update node
export const PATCH = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const input = updateNodeSchema.parse(body);

    const node = await prisma.node.findUnique({ where: { id } });
    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    const updated = await prisma.node.update({
      where: { id },
      data: {
        ...input,
        metadata: input.metadata as any,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'node.updated',
        nodeId: node.id,
        details: { input } as any,
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    return NextResponse.json({ node: updated });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('Update node error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to update node' },
      { status: 500 },
    );
  }
});

// DELETE /api/nodes/:id - Delete node
export const DELETE = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const node = await prisma.node.findUnique({
      where: { id },
      include: {
        _count: { select: { clients: true } },
        clients: { where: { status: 'ACTIVE' } },
      },
    });

    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    if (node.clients.length > 0) {
      return NextResponse.json(
        { error: 'NODE_HAS_CLIENTS', message: 'Cannot delete node with active clients' },
        { status: 400 },
      );
    }

    // Audit log (must be before deletion due to foreign key)
    await prisma.auditLog.create({
      data: {
        action: 'node.deleted',
        nodeId: node.id,
        details: { nodeName: node.name },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    await prisma.node.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete node error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to delete node' },
      { status: 500 },
    );
  }
});
