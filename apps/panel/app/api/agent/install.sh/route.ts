import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

// GET /api/agent/install.sh - Return agent installation script
export async function GET() {
  try {
    const scriptPath = join(process.cwd(), '../../install-agent.sh');
    const script = readFileSync(scriptPath, 'utf-8');

    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Failed to read install.sh:', error);
    return NextResponse.json(
      { error: 'INSTALL_SCRIPT_NOT_FOUND' },
      { status: 500 }
    );
  }
}
