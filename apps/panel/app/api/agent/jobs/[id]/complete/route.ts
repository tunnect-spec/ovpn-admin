import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyApiToken, encrypt } from '@/lib/crypto';

type Params = Promise<{ id: string }>;

interface CompleteJobRequest {
  success: boolean;
  result?: any;
  error?: string;
}

// POST /api/agent/jobs/:id/complete - Mark job as completed
export async function POST(request: NextRequest, { params }: { params: Params }) {
  try {
    // Verify token
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'INVALID_TOKEN', message: 'Missing or invalid token' },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7);
    const nodeId = await verifyApiToken(token);
    if (!nodeId) {
      return NextResponse.json(
        { error: 'INVALID_TOKEN', message: 'Token verification failed' },
        { status: 401 },
      );
    }

    const { id: jobId } = await params;
    const body: CompleteJobRequest = await request.json();

    // Find the job
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return NextResponse.json(
        { error: 'JOB_NOT_FOUND', message: 'Job not found' },
        { status: 404 },
      );
    }

    // Verify job belongs to this node
    if (job.nodeId !== nodeId) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Job does not belong to this node' },
        { status: 403 },
      );
    }

    // Check if job is in valid state
    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'JOB_ALREADY_FINISHED', message: 'Job is already finished' },
        { status: 400 },
      );
    }

    // Update job status
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: body.success ? 'COMPLETED' : 'FAILED',
        completedAt: new Date(),
        attempts: { increment: 1 },
        result: body.success ? body.result : null,
        error: body.success ? null : body.error || 'Unknown error',
        // Drive the progress bar cleanly to 100% on a successful install.
        ...(body.success && job.type === 'NODE_INSTALL'
          ? { progress: 100, progressMessage: 'Installation complete' }
          : {}),
      },
    });

    // If a NODE_INSTALL finished successfully, record the OpenVPN version + XOR
    // mask the agent reported, stamp installedAt, and flip the node to HEALTHY
    // immediately so the UI doesn't sit at "Installing" until the next heartbeat.
    if (body.success && job.type === 'NODE_INSTALL') {
      const result = (body.result ?? {}) as { version?: string; xorMask?: string };
      const existing = await prisma.node.findUnique({
        where: { id: nodeId },
        select: { installedAt: true },
      });
      await prisma.node.update({
        where: { id: nodeId },
        data: {
          status: 'HEALTHY',
          openvpnVersion: result.version ?? undefined,
          xorMask: result.xorMask ?? undefined,
          installedAt: existing?.installedAt ?? new Date(),
        },
      });
    }

    // If successful and it's a client creation, update client fingerprint
    if (body.success && job.type === 'CLIENT_CREATE' && body.result) {
      const result = body.result as any;
      const clientData = result.client || {};
      const { name, fingerprint, ovpnContent } = clientData;

      // Find client by name and node (skip gracefully if the agent didn't return
      // a name — never short-circuit before the audit log below).
      const client = name
        ? await prisma.vpnClient.findFirst({ where: { nodeId, name } })
        : null;
      if (!name) console.error('Client name missing in job result');

      if (client) {
        // Update client with real fingerprint
        await prisma.vpnClient.update({
          where: { id: client.id },
          data: {
            fingerprint: fingerprint || client.fingerprint,
          },
        });

        // Create artifact
        if (ovpnContent) {
          const ovpnDecoded = Buffer.from(ovpnContent, 'base64').toString('utf-8');
          // The .ovpn config embeds the client private key — encrypt it at rest.
          await prisma.clientArtifact.create({
            data: {
              clientId: client.id,
              nodeId,
              artifactType: 'OVPN',
              storagePath: await encrypt(ovpnDecoded),
              contentHash: fingerprint || '',
              sizeBytes: ovpnDecoded.length,
              downloadUrl: null,
              expiresAt: client.expiresAt,
            },
          });
        }
      }
    }

    // If successful client revocation
    if (body.success && job.type === 'CLIENT_REVOKE') {
      const payload = job.payload as any;
      const clientName = payload?.clientName;
      if (!clientName) console.error('Client name missing in job payload');

      const client = clientName
        ? await prisma.vpnClient.findFirst({ where: { nodeId, name: clientName } })
        : null;

      if (client && client.status === 'ACTIVE') {
        await prisma.vpnClient.update({
          where: { id: client.id },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
          },
        });
      }
    }

    // If an enable/disable FAILED on the node, revert the panel's optimistic
    // status so it never claims a client is blocked (or active) when it isn't.
    if (!body.success && (job.type === 'CLIENT_DISABLE' || job.type === 'CLIENT_ENABLE')) {
      const clientName = (job.payload as any)?.clientName;
      if (clientName) {
        await prisma.vpnClient.updateMany({
          where: { nodeId, name: clientName, status: { in: ['ACTIVE', 'DISABLED'] } },
          data:
            job.type === 'CLIENT_DISABLE'
              ? { status: 'ACTIVE', disabledAt: null } // disable failed → still active
              : { status: 'DISABLED' }, // enable failed → still disabled
        });
      }
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: `job.${body.success ? 'completed' : 'failed'}`,
        nodeId,
        details: {
          jobId,
          jobType: job.type,
          success: body.success,
        },
      },
    });

    return NextResponse.json({
      success: true,
      job: {
        id: updatedJob.id,
        status: updatedJob.status,
      },
    });
  } catch (error) {
    console.error('Complete job error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to complete job' },
      { status: 500 },
    );
  }
}
