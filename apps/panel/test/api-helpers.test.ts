import { describe, it, expect } from 'vitest';
import { loginSchema } from '@ovpn/api';
import { isZodError } from '@/lib/api-helpers';

describe('isZodError', () => {
  it('returns true for a thrown ZodError', () => {
    let caught: unknown;
    try {
      loginSchema.parse({});
    } catch (err) {
      caught = err;
    }
    expect(isZodError(caught)).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isZodError(new Error('x'))).toBe(false);
  });
});
