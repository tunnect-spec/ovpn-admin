import { prisma } from './prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY?.padEnd(32, '0').slice(0, 32) || 'default_encryption_key_change_me_32b';

// ============================================================================
// JWT (using Web Crypto API)
// ============================================================================

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

// Simple JWT implementation using base64url (for MVP)
// In production, use jose or similar
export async function createToken(payload: TokenPayload): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 7 * 24 * 60 * 60; // 7 days

  const tokenPayload = { ...payload, iat: now, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));

  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(data, JWT_SECRET);

  return `${data}.${signature}`;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const data = `${encodedHeader}.${encodedPayload}`;

    // Verify signature
    const expectedSignature = await hmacSha256(data, JWT_SECRET);
    if (signature !== expectedSignature) return null;

    // Decode payload
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as TokenPayload;

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function base64UrlEncode(str: string): string {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function hmacSha256(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const signatureArray = Array.from(new Uint8Array(signature));
  const binaryString = signatureArray.map(b => String.fromCharCode(b)).join('');
  return btoa(binaryString)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
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
  const data = encoder.encode(token + (process.env.API_TOKEN_SALT || 'default_api_salt'));

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
    encoder.encode(ENCRYPTION_KEY),
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
      encoder.encode(ENCRYPTION_KEY),
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
