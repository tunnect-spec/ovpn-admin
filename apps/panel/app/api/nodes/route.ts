import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createNodeSchema } from '@ovpn/api';
import { createRegistrationToken, hashApiToken } from '@/lib/crypto';
import { generateInstallCommand } from '@/lib/install';
import { withAuth } from '@/lib/middleware';
import type { NodeStatus } from '@ovpn/types';

// GET /api/nodes - List all nodes
async function GET_handler(request: NextRequest, payload: any) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    const where = status ? { status: status as NodeStatus } : {};

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
      nodes: nodes.map((n: any) => ({
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
async function POST_handler(request: NextRequest, payload: any) {
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
        metadata: (input.metadata ?? {}) as any,
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
        details: { input } as any,
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
        apiToken: apiToken.slice(0, 16) + '...', // Show partial only
      },
      installCommand,
      registrationToken,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && 'name' in error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'INVALID_INPUT', issues: error },
        { status: 400 },
      );
    }
    console.error('Create node error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to create node' },
      { status: 500 },
    );
  }
}

export const POST = withAuth(POST_handler);
