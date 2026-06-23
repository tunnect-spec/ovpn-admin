import { prisma } from './prisma';
import { SignJWT, jwtVerify } from 'jose';

// ============================================================================
// Secret resolution
// ----------------------------------------------------------------------------
// Secrets are resolved lazily (inside functions) rather than at module load so
// that a missing/weak secret fails the actual request in production instead of
// crashing the build. In production a missing or default-valued secret is a
// hard error; in development we fall back to a clearly-insecure value and warn.
// ============================================================================

const WEAK_SECRETS = new Set([
  'change_me_in_production',
  'change_me_in_production_please_use_32_chars_or_more',
  'default_encryption_key_change_me_32b',
  'default_salt',
  'default_api_salt',
]);

const isProduction = () => process.env.NODE_ENV === 'production';

const warnedFor = new Set<string>();
function warnOnce(name: string, message: string): void {
  if (warnedFor.has(name)) return;
  warnedFor.add(name);
  console.warn(`[security] ${message}`);
}

function requireSecret(name: string, value: string | undefined, minLength: number): string {
  const weak = !value || value.length < minLength || WEAK_SECRETS.has(value);
  if (weak) {
    if (isProduction()) {
      throw new Error(
        `${name} must be set to a strong, non-default value of at least ${minLength} characters in production.`,
      );
    }
    warnOnce(name, `${name} is missing/weak — using an INSECURE development fallback. Set a strong ${name} before deploying.`);
    return (value || `insecure_dev_only_${name.toLowerCase()}`).padEnd(minLength, '0');
  }
  return value;
}

function getJwtSecret(): string {
  return requireSecret('JWT_SECRET', process.env.JWT_SECRET, 32);
}

function getEncryptionKey(): string {
  return requireSecret('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY, 32).slice(0, 32);
}

function getApiTokenSalt(): string {
  return requireSecret('API_TOKEN_SALT', process.env.API_TOKEN_SALT, 16);
}

// ============================================================================
// JWT (using jose, HS256)
// ============================================================================

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export async function createToken(payload: TokenPayload): Promise<string> {
  const secret = new TextEncoder().encode(getJwtSecret());
  return await new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const secret = new TextEncoder().encode(getJwtSecret());
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

    if (typeof payload.sub !== 'string') return null;

    return {
      sub: payload.sub,
      email: payload.email as string,
      role: payload.role as string,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

import bcrypt from 'bcryptjs';

// ============================================================================
// Password Hashing
// ============================================================================

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

// ============================================================================
// API Token
// ============================================================================

export async function hashApiToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token + getApiTokenSalt());

  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

export async function verifyApiToken(token: string): Promise<string | null> {
  const hashedToken = await hashApiToken(token);
  const node = await prisma.node.findFirst({ where: { apiToken: hashedToken } });
  return node?.id ?? null;
}

// ============================================================================
// Registration Token
// ============================================================================

export function createRegistrationToken(): string {
  return crypto.randomUUID();
}

export async function verifyRegistrationToken(token: string) {
  return await prisma.nodeAuthToken.findUnique({
    where: { token },
  });
}

// ============================================================================
// Fingerprint Generation
// ============================================================================

export function generateFingerprint(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 32);
}

// ============================================================================
// Encryption (AES-GCM)
// ============================================================================

export async function encrypt(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getEncryptionKey()),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(text);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  );

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const encryptedHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${ivHex}:${encryptedHex}`;
}

export async function decrypt(encryptedText: string): Promise<string | null> {
  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');

    const iv = new Uint8Array(ivHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) ?? []);
    const encrypted = new Uint8Array(encryptedHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) ?? []);

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(getEncryptionKey()),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted,
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch {
    return null;
  }
}
