import { NextResponse } from 'next/server';
import { prisma } from '@ovpn/db';
import { hashApiToken, encrypt, decrypt } from '@/lib/crypto';

async function authenticate(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split('Bearer ')[1];
  if (!token) return null;

  const hashedToken = await hashApiToken(token);

  return await prisma.node.findFirst({
    where: { apiToken: hashedToken },
    select: { id: true, pkiBackup: true },
  });
}

export async function POST(request: Request) {
  try {
    const node = await authenticate(request);
    if (!node) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Read binary data from request
    const arrayBuffer = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return new NextResponse('Empty backup', { status: 400 });
    }

    // The PKI backup contains the CA private key — encrypt it at rest. We
    // store the encrypted "ivhex:cthex" string as UTF-8 bytes in the column.
    const enc = await encrypt(buffer.toString('base64'));
    await prisma.node.update({
      where: { id: node.id },
      data: { pkiBackup: Buffer.from(enc, 'utf-8') },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Backup upload error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const node = await authenticate(request);
    if (!node) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!node.pkiBackup) {
      return new NextResponse('No backup found', { status: 404 });
    }

    // Decrypt at-rest backups; fall back to raw bytes for legacy plaintext rows.
    const raw = Buffer.from(node.pkiBackup);
    const s = raw.toString('utf-8');
    const dec = await decrypt(s);
    const out = dec !== null ? Buffer.from(dec, 'base64') : raw;

    return new NextResponse(out, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="backup.tar.gz"',
      },
    });
  } catch (error) {
    console.error('Backup download error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
