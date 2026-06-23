import { describe, it, expect } from 'vitest';
import {
  createToken,
  verifyToken,
  encrypt,
  decrypt,
  hashApiToken,
  generateFingerprint,
} from '@/lib/crypto';

describe('JWT tokens', () => {
  const payload = { sub: 'user-123', email: 'admin@example.com', role: 'ADMIN' };

  it('createToken -> verifyToken round-trips sub/email/role', async () => {
    const token = await createToken(payload);
    const decoded = await verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe(payload.sub);
    expect(decoded?.email).toBe(payload.email);
    expect(decoded?.role).toBe(payload.role);
  });

  it('returns null for a tampered token', async () => {
    const token = await createToken(payload);
    // Flip a character in the signature segment to invalidate it.
    const idx = token.length - 1;
    const orig = token[idx];
    const swap = orig === 'a' ? 'b' : 'a';
    const tampered = token.slice(0, idx) + swap;
    expect(await verifyToken(tampered)).toBeNull();
  });

  it('returns null for garbage input', async () => {
    expect(await verifyToken('garbage.garbage.garbage')).toBeNull();
  });
});

describe('encryption', () => {
  it('encrypt -> decrypt round-trips a string', async () => {
    const secret = 'super-secret-value-42';
    const ciphertext = await encrypt(secret);
    expect(ciphertext).not.toBe(secret);
    expect(await decrypt(ciphertext)).toBe(secret);
  });

  it('decrypt returns null for non-encrypted input', async () => {
    expect(await decrypt('plain-not-encrypted')).toBeNull();
  });
});

describe('hashApiToken', () => {
  it('is deterministic for the same input', async () => {
    const a = await hashApiToken('token-abc');
    const b = await hashApiToken('token-abc');
    expect(a).toBe(b);
  });

  it('differs for different input', async () => {
    const a = await hashApiToken('token-abc');
    const b = await hashApiToken('token-xyz');
    expect(a).not.toBe(b);
  });
});

describe('generateFingerprint', () => {
  it('is 32 lowercase-hex characters', () => {
    const fp = generateFingerprint();
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });
});
