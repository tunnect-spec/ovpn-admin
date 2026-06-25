import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listAuditLogsSchema } from '@ovpn/api';
import { withAuth } from '@/lib/middleware';
import { accessibleNodeIds } from '@/lib/access';
import { isZodError, zodErrorResponse } from '@/lib/api-helpers';
import type { Prisma } from '@prisma/client';

// GET /api/audit-logs - List audit logs
export const GET = withAuth(async (request: NextRequest, payload) => {
  try {
    const { searchParams } = new URL(request.url);
    const input = listAuditLogsSchema.parse(Object.fromEntries(searchParams));

    const where: Prisma.AuditLogWhereInput = {};
    if (input.adminId) where.adminId = input.adminId;
    if (input.nodeId) where.nodeId = input.nodeId;
    if (input.clientId) where.clientId = input.clientId;
    if (input.action) where.action = input.action;
    if (input.from || input.to) {
      where.createdAt = {
        ...(input.from ? { gte: new Date(input.from) } : {}),
        ...(input.to ? { lte: new Date(input.to) } : {}),
      };
    }

    // Managers only see their own actions in the audit log; admins see all.
    const ids = await accessibleNodeIds(payload);
    if (ids !== null) {
      where.adminId = payload.sub;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: { id: true, email: true },
          },
          node: {
            select: { id: true, name: true },
          },
          client: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs: logs.map((log) => ({
        id: log.id,
        adminId: log.adminId,
        adminEmail: log.admin?.email ?? null,
        nodeId: log.nodeId,
        nodeName: log.node?.name ?? null,
        clientId: log.clientId,
        clientName: log.client?.name ?? null,
        action: log.action,
        details: log.details,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt.toISOString(),
      })),
      total,
    });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('List audit logs error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to list audit logs' },
      { status: 500 },
    );
  }
});
