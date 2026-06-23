import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { verifyApiToken } from './crypto';

/**
 * Type guard for ZodError that is resilient to multiple zod copies in a
 * monorepo (instanceof can fail across package boundaries).
 */
export function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof ZodError ||
    (error instanceof Error && error.name === 'ZodError' && 'issues' in error)
  );
}

/**
 * Standard 400 response for validation failures.
 * Returns the actual `issues` array (the previous `issues: error` serialized to
 * `{}` because Error instances JSON-stringify to an empty object).
 */
export function zodErrorResponse(error: unknown): NextResponse {
  const issues = isZodError(error) ? error.issues : undefined;
  return NextResponse.json({ error: 'INVALID_INPUT', issues }, { status: 400 });
}

/**
 * Authenticate an agent request by its Bearer API token.
 * Returns the node id on success, or null if the header is missing/invalid.
 * Centralizes the logic that was previously copy-pasted into several routes.
 */
export async function authenticateAgent(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verifyApiToken(authHeader.slice(7));
}

/** Standard 401 response for agent endpoints. */
export function agentUnauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'INVALID_TOKEN', message: 'Missing or invalid token' },
    { status: 401 },
  );
}
