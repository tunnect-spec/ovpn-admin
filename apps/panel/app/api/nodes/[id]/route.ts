import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updateNodeSchema } from '@ovpn/api';
import { withAuth, withFullAdmin } from '@/lib/middleware';
import { canAccessNode } from '@/lib/access';
import { isZodError, zodErrorResponse } from '@/lib/api-helpers';
import type { Prisma } from '@prisma/client';

type Params = Promise<{ id: string }>;

// GET /api/nodes/:id - Get node details (scoped to assigned nodes for managers)
export const GET = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    // Hide nodes a manager isn't assigned to (same 404 as a missing node — no
    // existence leak via enumeration).
    if (!(await canAccessNode(payload, id))) {
      return NextResponse.json({ error: 'NODE_NOT_FOUND', message: 'Node not found' }, { status: 404 });
    }

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
        // OpenVPN server configuration (for display + dialog pre-fill).
        protocol: node.protocol,
        ovpnPort: node.ovpnPort,
        obfuscation: node.obfuscation,
        cipher: node.cipher,
        authDigest: node.authDigest,
        tunnelMode: node.tunnelMode,
        clientToClient: node.clientToClient,
        duplicateCn: node.duplicateCn,
        domain: node.domain,
        dnsServers: node.dnsServers,
        mtu: node.mtu,
        mssfix: node.mssfix,
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
export const PATCH = withFullAdmin(async (request: NextRequest, payload, { params }: { params: Params }) => {
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
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'node.updated',
        nodeId: node.id,
        details: { input } as Prisma.InputJsonValue,
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
export const DELETE = withFullAdmin(async (request: NextRequest, payload, { params }: { params: Params }) => {
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
