'use client';

/**
 * Shared client-side fetch helper for dashboard pages.
 *
 * Centralizes the response.ok check, JSON parsing, and 401 handling so every
 * page surfaces errors consistently (toast + error state) instead of silently
 * swallowing them.
 */

/** Thrown when a request comes back 401 — callers redirect to /login. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.message || data?.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/**
 * Fetch JSON, checking response.ok before parsing. Throws UnauthorizedError on
 * 401 and ApiError on other non-OK responses. Pass an AbortSignal for cancellation.
 */
export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);

  if (res.status === 401) {
    throw new UnauthorizedError();
  }

  if (!res.ok) {
    throw new ApiError(await readMessage(res), res.status);
  }

  return (await res.json()) as T;
}

/** Like apiFetch but returns the raw Response (for blob downloads etc.). */
export async function apiFetchRaw(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);

  if (res.status === 401) {
    throw new UnauthorizedError();
  }

  if (!res.ok) {
    throw new ApiError(await readMessage(res), res.status);
  }

  return res;
}
