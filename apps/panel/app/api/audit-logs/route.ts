import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listAuditLogsSchema } from '@ovpn/api';
import { withAuth } from '@/lib/middleware';

// GET /api/audit-logs - List audit logs
export const GET = withAuth(async (request: NextRequest, payload) => {
  try {
    const { searchParams } = new URL(request.url);
    const input = listAuditLogsSchema.parse(Object.fromEntries(searchParams));

    const where: any = {};
    if (input.adminId) where.adminId = input.adminId;
    if (input.nodeId) where.nodeId = input.nodeId;
    if (input.clientId) where.clientId = input.clientId;
    if (input.action) where.action = input.action;
    if (input.from || input.to) {
      where.createdAt = {};
      if (input.from) where.createdAt.gte = new Date(input.from);
      if (input.to) where.createdAt.lte = new Date(input.to);
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
      logs: logs.map((log: any) => ({
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
    if (error instanceof Error && 'name' in error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'INVALID_INPUT', issues: error },
        { status: 400 },
      );
    }
    console.error('List audit logs error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to list audit logs' },
      { status: 500 },
    );
  }
});
