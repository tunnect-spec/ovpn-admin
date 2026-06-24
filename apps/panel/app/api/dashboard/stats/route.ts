import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/middleware';

// GET /api/dashboard/stats - Dashboard statistics
export const GET = withAuth(async (request: NextRequest, payload) => {
  try {
    const [
      totalNodes,
      healthyNodes,
      unhealthyNodes,
      pendingNodes,
      totalClients,
      activeClients,
      revokedClients,
      runningJobs,
      failedJobs,
      pendingJobs,
    ] = await Promise.all([
      // Nodes
      prisma.node.count(),
      prisma.node.count({ where: { status: 'HEALTHY' } }),
      prisma.node.count({ where: { status: 'UNHEALTHY' } }),
      // "Pending" covers both not-yet-connected (PENDING) and being-provisioned
      // (PROVISIONING); only true ERROR nodes land in the error bucket below.
      prisma.node.count({ where: { status: { in: ['PENDING', 'PROVISIONING'] } } }),
      // Clients
      prisma.vpnClient.count(),
      prisma.vpnClient.count({ where: { status: 'ACTIVE' } }),
      prisma.vpnClient.count({ where: { status: 'REVOKED' } }),
      // Jobs
      prisma.job.count({ where: { status: 'RUNNING' } }),
      prisma.job.count({ where: { status: 'FAILED' } }),
      prisma.job.count({ where: { status: 'PENDING' } }),
    ]);

    return NextResponse.json({
      nodes: {
        total: totalNodes,
        healthy: healthyNodes,
        unhealthy: unhealthyNodes,
        pending: pendingNodes,
        error: totalNodes - healthyNodes - unhealthyNodes - pendingNodes,
      },
      clients: {
        total: totalClients,
        active: activeClients,
        revoked: revokedClients,
        expired: totalClients - activeClients - revokedClients,
      },
      jobs: {
        running: runningJobs,
        failed: failedJobs,
        pending: pendingJobs,
      },
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to get stats' },
      { status: 500 },
    );
  }
});
