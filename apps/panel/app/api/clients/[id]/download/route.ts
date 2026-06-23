import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/middleware';
import { decrypt } from '@/lib/crypto';

type Params = Promise<{ id: string }>;

// GET /api/clients/:id/download - Download .ovpn config
export const GET = withAuth(async (request: NextRequest, payload, { params }: { params: Params }) => {
  try {
    const { id } = await params;

    const client = await prisma.vpnClient.findUnique({
      where: { id },
      include: {
        node: true,
        artifacts: {
          where: {
            artifactType: 'OVPN',
            // null expiresAt means "never expires" (e.g. client created without
            // an expiry); treat those as valid alongside not-yet-expired ones.
            OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!client) {
      return NextResponse.json(
        { error: 'CLIENT_NOT_FOUND', message: 'Client not found' },
        { status: 404 },
      );
    }

    if (client.status === 'REVOKED') {
      return NextResponse.json(
        { error: 'CLIENT_REVOKED', message: 'Client has been revoked' },
        { status: 403 },
      );
    }

    const artifact = client.artifacts[0];
    if (!artifact) {
      return NextResponse.json(
        { error: 'ARTIFACT_NOT_GENERATED', message: 'Config not yet generated. Check job status.' },
        { status: 404 },
      );
    }

    // Decrypt at-rest config; fall back to the stored value for legacy
    // plaintext rows that predate at-rest encryption.
    const stored = artifact.storagePath || '';
    const content = (stored && (await decrypt(stored))) || stored;

    if (!content) {
      return NextResponse.json(
        { error: 'ARTIFACT_NOT_FOUND', message: 'Config file is empty' },
        { status: 404 },
      );
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'client.downloaded',
        nodeId: client.nodeId,
        clientId: client.id,
        details: { clientName: client.name },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    // Return .ovpn file
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/x-openvpn-config',
        'Content-Disposition': `attachment; filename="${client.name}.ovpn"`,
        'Content-Length': Buffer.byteLength(content).toString(),
      },
    });
  } catch (error) {
    console.error('Download client error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to download config' },
      { status: 500 },
    );
  }
});
