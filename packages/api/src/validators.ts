import { z } from 'zod';

// ============================================================================
// Common Validators
// ============================================================================

const nodeNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Name may contain only letters, numbers, dots, underscores, hyphens');

const clientNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Name may contain only letters, numbers, dots, underscores, hyphens');

const hostSchema = z
  .string()
  .min(1, 'Host is required')
  .max(253, 'Host too long')
  .refine(
    (v) => {
      // IP or domain
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      return ipRegex.test(v) || domainRegex.test(v);
    },
    'Invalid host (IP or domain expected',
  );

const nodeIdSchema = z.string().cuid();

// ============================================================================
// Auth Validators
// ============================================================================

export const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ============================================================================
// Node Validators
// ============================================================================

export const createNodeSchema = z.object({
  name: nodeNameSchema,
  host: hostSchema,
  port: z.number().int().min(1).max(65535).optional().default(22),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateNodeInput = z.infer<typeof createNodeSchema>;

export const updateNodeSchema = z.object({
  name: nodeNameSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

// Obfuscation transforms supported by the openvpn-xorpatch `scramble` directive.
//   none      — plain OpenVPN (no scramble)
//   xormask   — XOR every byte with a random key (the classic XOR patch)
//   xorptrpos — XOR every byte with its buffer position
//   reverse   — reverse the byte order of each buffer
//   obfuscate — compound transform (xormask + xorptrpos + reverse), keyed
export const OBFUSCATION_MODES = ['none', 'xormask', 'xorptrpos', 'reverse', 'obfuscate'] as const;
export const DATA_CIPHERS = ['AES-256-GCM', 'AES-128-GCM', 'CHACHA20-POLY1305'] as const;
export const AUTH_DIGESTS = ['SHA256', 'SHA512'] as const;

export const installNodeSchema = z.object({
  serverHost: hostSchema.optional(),
  port: z.number().int().min(1).max(65535).optional().default(443),
  protocol: z.enum(['udp', 'tcp']).optional().default('udp'),
  firstUser: clientNameSchema.optional(),
  // Obfuscation. `obfuscation` is the source of truth; `useXor` is kept for
  // backward compatibility with older callers (true ⇒ xormask, false ⇒ none).
  obfuscation: z.enum(OBFUSCATION_MODES).optional(),
  useXor: z.boolean().optional().default(true),
  // Crypto knobs (safe AEAD defaults).
  cipher: z.enum(DATA_CIPHERS).optional().default('AES-256-GCM'),
  auth: z.enum(AUTH_DIGESTS).optional().default('SHA256'),
  // Routing / topology.
  tunnelMode: z.enum(['full', 'split']).optional().default('full'),
  clientToClient: z.boolean().optional().default(false),
  duplicateCn: z.boolean().optional().default(false),
  domain: z.string().optional(),
  dnsMode: z.enum(['standard', 'empty', 'custom']).optional().default('standard'),
  customDns: z.string().optional(),
  mtu: z.number().int().min(500).max(9000).optional().default(1500),
  mssfix: z.number().int().min(500).max(9000).optional().default(1360),
});

export type InstallNodeInput = z.infer<typeof installNodeSchema>;

// ============================================================================
// Client Validators
// ============================================================================

export const createClientSchema = z.object({
  name: clientNameSchema,
  expiresIn: z.number().int().min(1).max(3650).optional(), // days
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

// ============================================================================
// Agent Validators
// ============================================================================

export const agentRegisterSchema = z.object({
  token: z.string().min(32),
  agentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  systemInfo: z.object({
    os: z.string(),
    kernel: z.string(),
    arch: z.string(),
  }),
});

export type AgentRegisterInput = z.infer<typeof agentRegisterSchema>;

// Per-client cumulative traffic reported by the agent. Bytes are JS numbers
// (safe up to ~9 PB) and stored as BigInt on the panel.
export const clientTrafficSchema = z.object({
  name: clientNameSchema,
  bytesUp: z.number().int().min(0),
  bytesDown: z.number().int().min(0),
  online: z.boolean(),
  // Live-session details for currently-online clients (best-effort).
  connectedSince: z.number().int().min(0).optional(), // epoch seconds
  realAddress: z.string().max(64).optional(),
  vpnAddress: z.string().max(64).optional(),
});

export type ClientTrafficInput = z.infer<typeof clientTrafficSchema>;

export const agentHeartbeatSchema = z.object({
  nodeId: nodeIdSchema,
  status: z.enum(['INSTALLING', 'NOT_INSTALLED', 'RUNNING', 'STOPPED', 'ERROR']),
  openvpnVersion: z.string().max(40).optional(),
  xorMask: z.string().max(128).optional(),
  details: z
    .object({
      connectedClients: z.number().int().min(0).optional(),
      cpu: z.number().min(0).max(100).optional(),
      memory: z.number().min(0).optional(),
      disk: z.number().min(0).max(100).optional(),
      uptime: z.number().int().min(0).optional(),
    })
    .optional(),
  clients: z.array(clientTrafficSchema).max(5000).optional(),
});

export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatSchema>;

export const agentCreateClientSchema = z.object({
  nodeId: nodeIdSchema,
  clientName: clientNameSchema,
});

export type AgentCreateClientInput = z.infer<typeof agentCreateClientSchema>;

export const agentRevokeClientSchema = z.object({
  nodeId: nodeIdSchema,
  clientName: clientNameSchema,
});

export type AgentRevokeClientInput = z.infer<typeof agentRevokeClientSchema>;

// ============================================================================
// Job Validators
// ============================================================================

export const listJobsSchema = z.object({
  nodeId: nodeIdSchema.optional(),
  type: z.enum(['NODE_INSTALL', 'CLIENT_CREATE', 'CLIENT_REVOKE', 'NODE_SYNC', 'HEALTH_CHECK']).optional(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ListJobsInput = z.infer<typeof listJobsSchema>;

// ============================================================================
// Audit Log Validators
// ============================================================================

export const listAuditLogsSchema = z.object({
  adminId: z.string().cuid().optional(),
  nodeId: nodeIdSchema.optional(),
  clientId: z.string().cuid().optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;
