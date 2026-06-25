import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/middleware';
import { accessibleNodeIds, clientOwnershipWhere } from '@/lib/access';
import type { Prisma } from '@prisma/client';

const VALID_STATUS = ['ACTIVE', 'DISABLED', 'REVOKED', 'EXPIRED'];

// GET /api/clients - all clients across nodes (scoped to a manager's nodes),
// with search / node / status / creator filters. Powers the global Clients view.
export const GET = withAuth(async (request: NextRequest, payload) => {
  try {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim();
    const statusParam = searchParams.get('status');
    const nodeIdParam = searchParams.get('nodeId');
    const createdByParam = searchParams.get('createdById');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '100') || 100));

    const ids = await accessibleNodeIds(payload);

    // Base scope = nodes the user may see. The creator-filter options are built
    // from this scope (independent of the other filters) so the dropdown is stable.
    const scope: { nodeId?: string | { in: string[] } } = {};
    if (ids !== null) scope.nodeId = { in: ids };

    if (nodeIdParam) {
      if (ids !== null && !ids.includes(nodeIdParam)) {
        return NextResponse.json({ clients: [], total: 0, page, limit, creators: [] });
      }
      scope.nodeId = nodeIdParam;
    }

    // Managers see only clients they created; full admins see all.
    const ownership = clientOwnershipWhere(payload);

    const where: Prisma.VpnClientWhereInput = { ...scope, ...ownership };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (statusParam && VALID_STATUS.includes(statusParam)) {
      where.status = statusParam as Prisma.VpnClientWhereInput['status'];
    }
    if (createdByParam && !ownership.createdById) where.createdById = createdByParam;

    const [clients, total, creators] = await Promise.all([
      prisma.vpnClient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          node: { select: { id: true, name: true } },
          createdBy: { select: { id: true, email: true } },
          _count: { select: { artifacts: true } },
        },
      }),
      prisma.vpnClient.count({ where }),
      prisma.admin.findMany({
        where: { createdClients: { some: { ...scope, ...ownership } } },
        select: { id: true, email: true },
        orderBy: { email: 'asc' },
      }),
    ]);

    return NextResponse.json({
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        nodeId: c.nodeId,
        nodeName: c.node.name,
        createdById: c.createdById,
        createdByEmail: c.createdBy?.email ?? null,
        createdAt: c.createdAt.toISOString(),
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
      total,
      page,
      limit,
      creators: creators.map((a) => ({ id: a.id, email: a.email })),
    });
  } catch (error) {
    console.error('List clients error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to list clients' }, { status: 500 });
  }
});
