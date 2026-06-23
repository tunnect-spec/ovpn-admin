import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { installNodeSchema } from '@ovpn/api';
import { withAuth } from '@/lib/middleware';
import { isZodError, zodErrorResponse } from '@/lib/api-helpers';

type Params = Promise<{ id: string }>;

// POST /api/nodes/:id/install - Trigger OpenVPN installation
export const POST = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const input = installNodeSchema.parse(body);

    const node = await prisma.node.findUnique({ where: { id } });
    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    if (node.status === 'HEALTHY' || node.installedAt) {
      return NextResponse.json(
        { error: 'NODE_ALREADY_INSTALLED', message: 'Node already has OpenVPN installed' },
        { status: 400 },
      );
    }

    if (node.status === 'UNHEALTHY' || node.status === 'ERROR') {
      // Allow retry install
    }

    // Check if agent is connected (recent heartbeat)
    if (!node.lastHeartbeatAt || Date.now() - node.lastHeartbeatAt.getTime() > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: 'AGENT_OFFLINE', message: 'Agent is not connected. Install agent first.' },
        { status: 503 },
      );
    }

    // Create install job
    const job = await prisma.job.create({
      data: {
        type: 'NODE_INSTALL',
        status: 'PENDING',
        priority: 10,
        nodeId: node.id,
        payload: {
          serverHost: input.serverHost,
          port: input.port,
          protocol: input.protocol,
          firstUser: input.firstUser,
          useXor: input.useXor,
          domain: input.domain,
          dnsMode: input.dnsMode,
          customDns: input.customDns,
          mtu: input.mtu,
          mssfix: input.mssfix,
          restore: !!node.pkiBackup,
        },
        maxAttempts: 3,
      },
    });

    // Update node status and save settings
    await prisma.node.update({
      where: { id },
      data: { 
        status: 'PROVISIONING',
        useXor: input.useXor,
        domain: input.domain || null,
        dnsServers: input.dnsMode === 'standard' ? ['8.8.8.8', '1.1.1.1'] : 
                    input.dnsMode === 'custom' && input.customDns ? input.customDns.split(',').map(s => s.trim()) : [],
        mtu: input.mtu,
        mssfix: input.mssfix,
      },
    });

    // The PENDING job above is the source of truth — the on-host agent picks it
    // up via its heartbeat poll. (No separate BullMQ enqueue is needed.)

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'node.install_triggered',
        nodeId: node.id,
        details: { jobId: job.id },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    return NextResponse.json({
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
      },
    });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('Install node error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to trigger install' },
      { status: 500 },
    );
  }
});
