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

    // An already-installed node is reconfigured rather than rebuilt: the
    // installer's fast path regenerates the config and restarts in seconds with
    // the PKI untouched (existing clients keep working). So we DON'T reject an
    // installed/HEALTHY node here — re-running install == applying new options.
    const isReconfigure = node.status === 'HEALTHY' || !!node.installedAt;

    // Don't stack installs: if one is already queued or running for this node,
    // return the existing job instead of creating a duplicate. (Without this, a
    // user clicking "Install" repeatedly piles up jobs and keeps resetting the
    // node to PROVISIONING.)
    const inFlight = await prisma.job.findFirst({
      where: { nodeId: node.id, type: 'NODE_INSTALL', status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, status: true },
    });
    if (inFlight) {
      return NextResponse.json(
        { error: 'INSTALL_IN_PROGRESS', message: 'An installation is already in progress for this node.', job: inFlight },
        { status: 409 },
      );
    }

    // Check if agent is connected (recent heartbeat)
    if (!node.lastHeartbeatAt || Date.now() - node.lastHeartbeatAt.getTime() > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: 'AGENT_OFFLINE', message: 'Agent is not connected. Install agent first.' },
        { status: 503 },
      );
    }

    // `obfuscation` is the source of truth; fall back to the legacy useXor flag.
    const obfuscation = input.obfuscation ?? (input.useXor === false ? 'none' : 'xormask');
    const useXor = obfuscation !== 'none';

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
          obfuscation,
          useXor,
          cipher: input.cipher,
          auth: input.auth,
          tunnelMode: input.tunnelMode,
          clientToClient: input.clientToClient,
          duplicateCn: input.duplicateCn,
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

    // Update node status and save the chosen settings so the panel reflects the
    // live config and can pre-fill the dialog on a reconfigure.
    await prisma.node.update({
      where: { id },
      data: {
        // A reconfigure keeps OpenVPN up (fast restart), so don't flip a HEALTHY
        // node to PROVISIONING; a fresh install moves PENDING → PROVISIONING.
        status: isReconfigure ? node.status : 'PROVISIONING',
        protocol: input.protocol,
        ovpnPort: input.port,
        obfuscation,
        useXor,
        cipher: input.cipher,
        authDigest: input.auth,
        tunnelMode: input.tunnelMode,
        clientToClient: input.clientToClient,
        duplicateCn: input.duplicateCn,
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
        action: isReconfigure ? 'node.reconfigured' : 'node.install_triggered',
        nodeId: node.id,
        details: { jobId: job.id, obfuscation, cipher: input.cipher, auth: input.auth, protocol: input.protocol, port: input.port },
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
