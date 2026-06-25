import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthPayload, FULL_ADMIN_ROLES } from './auth';

/**
 * Next.js route-handler context. Dynamic routes receive their params as a
 * promise; static routes receive an empty object. Handlers that read params
 * narrow `P` to their own segment shape.
 */
export type RouteContext<P = Record<string, string>> = { params: Promise<P> };

type AuthedHandler<P> = (
  request: NextRequest,
  payload: AuthPayload,
  context: RouteContext<P>,
) => Promise<NextResponse>;

/**
 * Require authentication for an API route. Returns 401 if not authenticated,
 * otherwise calls the handler. Any valid role (incl. MANAGER) is allowed —
 * routes that need finer scoping do their own node-access checks.
 */
export function withAuth<P = Record<string, string>>(handler: AuthedHandler<P>) {
  return async (request: NextRequest, context: RouteContext<P>) => {
    try {
      const payload = await requireAuth(request);
      return await handler(request, payload, context);
    } catch {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }
  };
}

/**
 * Require a FULL admin (SUPERADMIN/ADMIN). Managers get 403. Use for node
 * lifecycle (create/install/migrate/delete) and admin/manager management.
 */
export function withFullAdmin<P = Record<string, string>>(handler: AuthedHandler<P>) {
  return async (request: NextRequest, context: RouteContext<P>) => {
    try {
      const payload = await requireAuth(request);
      if (!FULL_ADMIN_ROLES.includes(payload.role)) {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: 'Administrator access required' },
          { status: 403 }
        );
      }
      return await handler(request, payload, context);
    } catch {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }
  };
}
