import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { agentRegisterSchema } from '@ovpn/api';
import { verifyRegistrationToken, hashApiToken } from '@/lib/crypto';

// POST /api/agent/register - Agent registration (one-time)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = agentRegisterSchema.parse(body);

    // Verify registration token
    const tokenRecord = await verifyRegistrationToken(input.token);
    if (!tokenRecord) {
      return NextResponse.json(
        { error: 'INVALID_TOKEN', message: 'Registration token invalid or expired' },
        { status: 400 },
      );
    }

    if (tokenRecord.usedAt) {
      return NextResponse.json(
        { error: 'TOKEN_ALREADY_USED', message: 'Registration token already used' },
        { status: 409 },
      );
    }

    if (tokenRecord.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'TOKEN_EXPIRED', message: 'Registration token expired' },
        { status: 400 },
      );
    }

    // Get node
    if (!tokenRecord.nodeId) {
      return NextResponse.json(
        { error: 'INVALID_TOKEN', message: 'Invalid token' },
        { status: 400 },
      );
    }

    const node = await prisma.node.findUnique({
      where: { id: tokenRecord.nodeId },
    });

    if (!node) {
      return NextResponse.json(
        { error: 'NODE_NOT_FOUND', message: 'Node not found' },
        { status: 404 },
      );
    }

    // Allow re-registration for existing nodes (Migration)
    // We just update the API token.

    // Mark token as used
    await prisma.nodeAuthToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    // Update node status and generate new API token for agent authentication
    const rawApiToken = crypto.randomUUID();
    const hashedApiToken = await hashApiToken(rawApiToken);

    await prisma.node.update({
      where: { id: node.id },
      data: {
        status: 'PROVISIONING',
        version: input.agentVersion,
        lastHeartbeatAt: new Date(),
        apiToken: hashedApiToken,
        metadata: input.systemInfo ? (input.systemInfo as any) : undefined,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'node.agent_registered',
        nodeId: node.id,
        details: {
          agentVersion: input.agentVersion,
          systemInfo: input.systemInfo,
        },
      },
    });

    return NextResponse.json({
      success: true,
      node: {
        id: node.id,
        name: node.name,
        apiToken: rawApiToken,
      },
    });
  } catch (error) {
    if (error instanceof Error && 'name' in error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'INVALID_INPUT', issues: error },
        { status: 400 },
      );
    }
    console.error('Register agent error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Registration failed' },
      { status: 500 },
    );
  }
}
