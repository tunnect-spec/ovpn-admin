import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

// GET /install-agent.sh - Serve the agent installer script
export async function GET(request: NextRequest) {
  try {
    const scriptPath = join(process.cwd(), '../install-agent.sh');
    const script = readFileSync(scriptPath, 'utf-8');

    // SECURITY: the panel URL must come from trusted server-side configuration,
    // never from the request Host/X-Forwarded-Proto headers. An attacker who can
    // set those headers could otherwise point a freshly-installed agent (and its
    // bearer token) at a host they control, or downgrade it to cleartext http.
    const fullUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.PANEL_URL;
    if (!fullUrl) {
      console.error('Cannot serve installer: NEXT_PUBLIC_APP_URL / PANEL_URL is not configured');
      return new NextResponse('Panel URL is not configured', { status: 500 });
    }

    // Replace placeholder with the configured URL
    const modifiedScript = script.replace(/PANEL_URL="https:\/\/panel\.example\.com"/g, `PANEL_URL="${fullUrl}"`);

    return new NextResponse(modifiedScript, {
      headers: {
        'Content-Type': 'text/x-shellscript',
        'Content-Disposition': 'attachment; filename="install-agent.sh"',
      },
    });
  } catch (error) {
    console.error('Serve installer error:', error);
    return new NextResponse('Installer script not found', { status: 404 });
  }
}
