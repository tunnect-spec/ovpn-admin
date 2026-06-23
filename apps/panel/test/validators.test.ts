import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  createNodeSchema,
  createClientSchema,
  installNodeSchema,
} from '@ovpn/api';

describe('loginSchema', () => {
  it('rejects password shorter than 8 chars', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'short' }).success).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'longenough' }).success).toBe(false);
  });

  it('accepts a valid login', () => {
    expect(loginSchema.safeParse({ email: 'admin@example.com', password: 'password123' }).success).toBe(true);
  });
});

describe('createNodeSchema', () => {
  it('rejects names with spaces', () => {
    expect(createNodeSchema.safeParse({ name: 'bad name', host: '1.2.3.4' }).success).toBe(false);
  });

  it('rejects names with "!"', () => {
    expect(createNodeSchema.safeParse({ name: 'bad!', host: '1.2.3.4' }).success).toBe(false);
  });

  it('accepts name "a.b-c_d"', () => {
    expect(createNodeSchema.safeParse({ name: 'a.b-c_d', host: '1.2.3.4' }).success).toBe(true);
  });

  it('accepts an IP host', () => {
    expect(createNodeSchema.safeParse({ name: 'node1', host: '1.2.3.4' }).success).toBe(true);
  });

  it('accepts a domain host', () => {
    expect(createNodeSchema.safeParse({ name: 'node1', host: 'vpn.example.com' }).success).toBe(true);
  });

  it('rejects host "!!bad!!"', () => {
    expect(createNodeSchema.safeParse({ name: 'node1', host: '!!bad!!' }).success).toBe(false);
  });
});

describe('createClientSchema', () => {
  it('accepts expiresIn within bounds', () => {
    expect(createClientSchema.safeParse({ name: 'client1', expiresIn: 1 }).success).toBe(true);
    expect(createClientSchema.safeParse({ name: 'client1', expiresIn: 3650 }).success).toBe(true);
  });

  it('rejects expiresIn below the lower bound', () => {
    expect(createClientSchema.safeParse({ name: 'client1', expiresIn: 0 }).success).toBe(false);
  });

  it('rejects expiresIn above the upper bound', () => {
    expect(createClientSchema.safeParse({ name: 'client1', expiresIn: 3651 }).success).toBe(false);
  });
});

describe('installNodeSchema', () => {
  it('applies defaults for port, protocol, and mtu', () => {
    const parsed = installNodeSchema.parse({});
    expect(parsed.port).toBe(443);
    expect(parsed.protocol).toBe('udp');
    expect(parsed.mtu).toBe(1500);
  });
});
