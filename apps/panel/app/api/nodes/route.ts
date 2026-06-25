import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createNodeSchema } from '@ovpn/api';
import { createRegistrationToken, hashApiToken } from '@/lib/crypto';
import { generateInstallCommand } from '@/lib/install';
import { withAuth, withFullAdmin } from '@/lib/middleware';
import { accessibleNodeIds } from '@/lib/access';
import { isZodError, zodErrorResponse } from '@/lib/api-helpers';
import type { AuthPayload } from '@/lib/auth';
import type { NodeStatus } from '@ovpn/types';
import type { Prisma } from '@prisma/client';

// GET /api/nodes - List nodes (managers see only their assigned nodes)
async function GET_handler(request: NextRequest, payload: AuthPayload) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20') || 20));
    const skip = (page - 1) * limit;

    // Only filter by status when it's a valid NodeStatus — a bogus value must
    // not reach Prisma (which would throw → 500). Unknown values are ignored.
    const VALID_STATUSES = ['PENDING', 'PROVISIONING', 'HEALTHY', 'UNHEALTHY', 'ERROR'];
    const where: { status?: NodeStatus; id?: { in: string[] } } =
      status && VALID_STATUSES.includes(status) ? { status: status as NodeStatus } : {};

    // Managers only see nodes assigned to them.
    const allowedIds = await accessibleNodeIds(payload);
    if (allowedIds !== null) where.id = { in: allowedIds };

    const [nodes, total] = await Promise.all([
      prisma.node.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          host: true,
          status: true,
          version: true,
          openvpnVersion: true,
          lastHeartbeatAt: true,
          createdAt: true,
          healthChecks: {
            orderBy: { checkedAt: 'desc' },
            take: 1,
            select: {
              status: true,
              details: true,
              checkedAt: true,
            },
          },
        },
      }),
      prisma.node.count({ where }),
    ]);

    return NextResponse.json({
      nodes: nodes.map((n) => ({
        ...n,
        lastHeartbeatAt: n.lastHeartbeatAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        healthStatus: n.healthChecks[0] ?? null,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('List nodes error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to list nodes' },
      { status: 500 },
    );
  }
}

export const GET = withAuth(GET_handler);

// POST /api/nodes - Create new node
async function POST_handler(request: NextRequest) {
  try {
    const body = await request.json();
    const input = createNodeSchema.parse(body);

    // Check for duplicate host
    const existing = await prisma.node.findFirst({ where: { host: input.host } });
    if (existing) {
      return NextResponse.json(
        { error: 'NODE_ALREADY_EXISTS', message: 'Node with this host already exists' },
        { status: 409 },
      );
    }

    // Generate tokens
    const apiToken = await hashApiToken(crypto.randomUUID());
    const registrationToken = createRegistrationToken();

    // Create node
    const node = await prisma.node.create({
      data: {
        name: input.name,
        host: input.host,
        port: input.port ?? 22,
        status: 'PENDING',
        apiToken,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    // Create registration token record
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await prisma.nodeAuthToken.create({
      data: {
        token: registrationToken,
        nodeId: node.id,
        expiresAt,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'node.created',
        nodeId: node.id,
        details: { input } as Prisma.InputJsonValue,
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    const installCommand = generateInstallCommand(registrationToken);

    return NextResponse.json({
      node: {
        id: node.id,
        name: node.name,
        host: node.host,
        status: node.status,
      },
      installCommand,
      registrationToken,
    }, { status: 201 });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('Create node error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to create node' },
      { status: 500 },
    );
  }
}

// Creating nodes is a full-admin action — managers cannot.
export const POST = withFullAdmin(POST_handler);
