import { NextResponse } from 'next/server';
import { prisma } from '@ovpn/db';
import { verifyApiToken } from '@/lib/crypto';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const nodeId = await verifyApiToken(token);

    if (!nodeId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job || job.nodeId !== nodeId) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const { progress, message } = await request.json();

    await prisma.job.update({
      where: { id },
      data: {
        progress: typeof progress === 'number' ? progress : undefined,
        progressMessage: typeof message === 'string' ? message : undefined,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Job progress error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
