import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateAgent, agentUnauthorized } from '@/lib/api-helpers';

// POST /api/agent/sync - Sync clients state
export async function POST(request: NextRequest) {
  try {
    const nodeId = await authenticateAgent(request);
    if (!nodeId) return agentUnauthorized();

    // Parse body if present, otherwise empty object
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is OK for sync
    }

    // Get all clients for this node
    const clients = await prisma.vpnClient.findMany({
      where: { nodeId },
      orderBy: { createdAt: 'desc' },
      select: {
        name: true,
        status: true,
        fingerprint: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      clients: clients.map((c: any) => ({
        name: c.name,
        status: c.status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
        fingerprint: c.fingerprint,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Agent sync error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Sync failed' },
      { status: 500 },
    );
  }
}
