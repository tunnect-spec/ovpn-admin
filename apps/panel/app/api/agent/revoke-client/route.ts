import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { agentRevokeClientSchema } from '@ovpn/api';
import { authenticateAgent, agentUnauthorized, isZodError, zodErrorResponse } from '@/lib/api-helpers';

// POST /api/agent/revoke-client - Agent revokes client certificate
export async function POST(request: NextRequest) {
  try {
    const nodeId = await authenticateAgent(request);
    if (!nodeId) return agentUnauthorized();

    const body = await request.json();
    const input = agentRevokeClientSchema.parse({ ...body, nodeId });

    // Find client
    const client = await prisma.vpnClient.findFirst({
      where: {
        nodeId: input.nodeId,
        name: input.clientName,
      },
    });

    if (!client) {
      return NextResponse.json(
        { error: 'CLIENT_NOT_FOUND', message: 'Client not found' },
        { status: 404 },
      );
    }

    // Update status
    await prisma.vpnClient.update({
      where: { id: client.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
      },
    });

    // Expire artifacts
    await prisma.clientArtifact.updateMany({
      where: { clientId: client.id },
      data: { expiresAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('Agent revoke client error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to revoke client' },
      { status: 500 },
    );
  }
}
