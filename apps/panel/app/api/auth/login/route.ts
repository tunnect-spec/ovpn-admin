import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loginSchema } from '@ovpn/api';
import { verifyPassword, createToken } from '@/lib/crypto';
import { isZodError, zodErrorResponse } from '@/lib/api-helpers';
import { rateLimit } from '@/lib/rate-limit';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

// POST /api/auth/login
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    // Rate limit by client IP + email to throttle credential-stuffing/brute force.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed, retryAfterSec } = await rateLimit(
      `login:${ip}:${email.toLowerCase()}`,
      { limit: 10, windowSec: 900 },
    );
    if (!allowed) {
      return NextResponse.json(
        { error: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
      );
    }

    const admin = await prisma.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      await logFailedLogin(request, null);
      return NextResponse.json(
        { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    const isValid = await verifyPassword(admin.passwordHash, password);
    if (!isValid) {
      await logFailedLogin(request, admin.id);
      return NextResponse.json(
        { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    // Update last login
    await prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    // Create JWT
    const token = await createToken({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    });

    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(request));

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'admin.login',
        adminId: admin.id,
        details: { success: true },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });

    // Note: the token is intentionally NOT returned in the body — it lives only
    // in the HttpOnly cookie set above, so it is never exposed to client JS.
    return NextResponse.json({
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    if (isZodError(error)) return zodErrorResponse(error);
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Login failed' },
      { status: 500 },
    );
  }
}

/**
 * Record a failed login attempt. Best-effort only — never let an audit-log
 * failure surface as a 500 to the caller.
 */
async function logFailedLogin(request: NextRequest, adminId: string | null): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: 'admin.login_failed',
        ...(adminId ? { adminId } : {}),
        details: { success: false },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    });
  } catch (error) {
    console.error('Failed to write login_failed audit log:', error);
  }
}
