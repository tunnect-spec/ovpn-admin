import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { agentHeartbeatSchema } from '@ovpn/api';
import { authenticateAgent, agentUnauthorized, isZodError, zodErrorResponse } from '@/lib/api-helpers';

// POST /api/agent/heartbeat - Agent heartbeat
export async function POST(request: NextRequest) {
  try {
    const nodeId = await authenticateAgent(request);
    if (!nodeId) return agentUnauthorized();

    const body = await request.json();
    const input = agentHeartbeatSchema.parse({ ...body, nodeId });

    // Get node
    const node = await prisma.node.findUnique({
      where: { id: nodeId },
    });

    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    // Determine new node status from the agent-reported OpenVPN state.
    //   RUNNING        → HEALTHY
    //   NOT_INSTALLED  → agent is alive but OpenVPN isn't installed yet. Keep the
    //                    node in the provisioning lane so the operator can trigger
    //                    the install — never flip it to ERROR. Don't downgrade a
    //                    node that has already been installed/healthy.
    //   STOPPED        → installed but the service is down → UNHEALTHY (recoverable)
    //   ERROR          → a genuine agent/host failure
    //   INSTALLING     → install in progress
    let newStatus = node.status;
    if (input.status === 'RUNNING') {
      newStatus = 'HEALTHY';
    } else if (input.status === 'NOT_INSTALLED') {
      // OpenVPN genuinely isn't installed yet (agent is healthy). Park the node
      // in the provisioning lane and recover it from any earlier transient
      // ERROR/UNHEALTHY. Only an already-HEALTHY node is left untouched.
      if (node.status !== 'HEALTHY') {
        newStatus = 'PROVISIONING';
      }
    } else if (input.status === 'STOPPED') {
      newStatus = 'UNHEALTHY';
    } else if (input.status === 'ERROR') {
      newStatus = 'ERROR';
    } else if (input.status === 'INSTALLING') {
      newStatus = 'PROVISIONING';
    }

    // Update heartbeat
    const now = new Date();
    await prisma.node.update({
      where: { id: nodeId },
      data: {
        lastHeartbeatAt: now,
        status: newStatus,
        installedAt: newStatus === 'HEALTHY' && !node.installedAt ? now : node.installedAt,
        // Keep the displayed OpenVPN version / XOR mask in sync with the node.
        ...(input.openvpnVersion ? { openvpnVersion: input.openvpnVersion } : {}),
        ...(input.xorMask ? { xorMask: input.xorMask } : {}),
      },
    });

    // Store a health check — but only once OpenVPN is actually installed. A
    // not-yet-installed node has no service to be "down", so recording DOWN for
    // it would make a perfectly healthy, freshly-attached node look broken.
    if (input.status !== 'NOT_INSTALLED') {
      const cpu = input.details?.cpu ?? 0;
      const disk = input.details?.disk ?? 0;
      const healthStatus =
        input.status === 'ERROR' || input.status === 'STOPPED'
          ? 'DOWN'
          : cpu >= 95 || disk >= 95
            ? 'DEGRADED'
            : 'HEALTHY';

      await prisma.healthCheck.create({
        data: {
          nodeId,
          status: healthStatus,
          details: input.details ?? {},
          checkedAt: now,
        },
      });
    }

    // Persist per-client traffic + live-session details (reported by the agent).
    // When online: stamp lastSeenAt and the current session (since / IPs).
    // When offline: clear the session fields so stale data isn't shown.
    if (input.clients && input.clients.length > 0) {
      await Promise.all(
        input.clients.map((c) =>
          prisma.vpnClient.updateMany({
            where: { nodeId, name: c.name },
            data: {
              bytesUp: BigInt(c.bytesUp),
              bytesDown: BigInt(c.bytesDown),
              online: c.online,
              ...(c.online
                ? {
                    lastSeenAt: now,
                    connectedSince: c.connectedSince ? new Date(c.connectedSince * 1000) : null,
                    realAddress: c.realAddress ?? null,
                    vpnAddress: c.vpnAddress ?? null,
                  }
                : { connectedSince: null, realAddress: null, vpnAddress: null }),
            },
          }),
        ),
      );
    }

    // Get pending jobs for this node
    const pendingJobs = await prisma.job.findMany({
      where: {
        nodeId,
        status: 'PENDING',
      },
      orderBy: { priority: 'desc' },
      take: 5,
      select: {
        id: true,
        type: true,
        payload: true,
      },
    });

    // Mark jobs as running
    if (pendingJobs.length > 0) {
      await prisma.job.updateMany({
        where: {
          id: { in: pendingJobs.map((j) => j.id) },
        },
        data: {
          status: 'RUNNING',
          startedAt: now,
        },
      });
    }

    return NextResponse.json({
      success: true,
      serverTime: now.toISOString(),
      pendingJobs,
    });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('Heartbeat error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Heartbeat failed' },
      { status: 500 },
    );
  }
}
