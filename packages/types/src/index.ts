// ============================================================================
// Shared Types
// ============================================================================

export interface Admin {
  id: string;
  email: string;
  role: 'SUPERADMIN' | 'ADMIN';
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface Node {
  id: string;
  name: string;
  host: string;
  port: number;
  status: NodeStatus;
  version: string | null;
  openvpnVersion: string | null;
  xorMask: string | null;
  lastHeartbeatAt: Date | null;
  installedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown> | null;
}

export type NodeStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'HEALTHY'
  | 'UNHEALTHY'
  | 'ERROR';

export interface VpnClient {
  id: string;
  nodeId: string;
  name: string;
  status: ClientStatus;
  fingerprint: string;
  createdAt: Date;
  revokedAt: Date | null;
  expiresAt: Date | null;
  lastSeenAt: Date | null;
}

export type ClientStatus = 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'EXPIRED';

export interface ClientArtifact {
  id: string;
  clientId: string;
  nodeId: string;
  artifactType: ArtifactType;
  storagePath: string | null;
  contentHash: string;
  sizeBytes: number;
  downloadUrl: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export type ArtifactType = 'OVPN' | 'MOBILE_CONFIG';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  nodeId: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export type JobType =
  | 'NODE_INSTALL'
  | 'CLIENT_CREATE'
  | 'CLIENT_REVOKE'
  | 'NODE_SYNC'
  | 'HEALTH_CHECK';

export type JobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface HealthCheck {
  id: string;
  nodeId: string;
  status: HealthStatus;
  details: HealthDetails;
  errorMessage: string | null;
  checkedAt: Date;
}

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface HealthDetails {
  cpu?: number;
  memory?: number;
  disk?: number;
  connectedClients?: number;
  uptime?: number;
}

export interface AuditLog {
  id: string;
  adminId: string | null;
  nodeId: string | null;
  clientId: string | null;
  action: string;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  admin: Pick<Admin, 'id' | 'email' | 'role'>;
  token: string;
}

// Nodes
export interface CreateNodeRequest {
  name: string;
  host: string;
  port?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateNodeResponse {
  node: Pick<Node, 'id' | 'name' | 'host' | 'status'> & {
    apiToken: string;
    installCommand: string;
  };
  registrationToken: string;
}

export interface InstallNodeRequest {
  serverHost?: string;
  port?: number;
  protocol?: 'udp' | 'tcp';
  firstUser?: string;
}

// Clients
export interface CreateClientRequest {
  name: string;
  expiresIn?: number;
}

export interface CreateClientResponse {
  client: Pick<VpnClient, 'id' | 'name' | 'status'>;
  job: Pick<Job, 'id' | 'type' | 'status'>;
}

// Agent API
export interface AgentRegisterRequest {
  token: string;
  agentVersion: string;
  systemInfo: {
    os: string;
    kernel: string;
    arch: string;
  };
}

export interface AgentRegisterResponse {
  success: true;
  node: {
    id: string;
    name: string;
    apiToken: string;
  };
  config?: {
    serverHost?: string;
    port?: number;
    protocol?: 'udp' | 'tcp';
    xorMask?: string;
  };
}

export interface AgentHeartbeatRequest {
  nodeId: string;
  status: 'INSTALLING' | 'RUNNING' | 'STOPPED' | 'ERROR';
  details?: HealthDetails;
}

export interface AgentHeartbeatResponse {
  success: true;
  serverTime: string;
  pendingJobs?: Array<{
    id: string;
    type: JobType;
    payload: Record<string, unknown>;
  }>;
}

export interface AgentCreateClientRequest {
  nodeId: string;
  clientName: string;
}

export interface AgentCreateClientResponse {
  success: true;
  client: {
    name: string;
    fingerprint: string;
    ovpnContent: string; // base64 encoded
    createdAt: string;
  };
}

export interface AgentRevokeClientRequest {
  nodeId: string;
  clientName: string;
}

export interface AgentRevokeClientResponse {
  success: true;
}

export interface AgentStatusResponse {
  status: {
    openvpn: 'RUNNING' | 'STOPPED' | 'ERROR';
    version?: string;
    xorMask?: string;
    connectedClients: number;
    uptime: number;
    port: number;
    protocol: 'udp' | 'tcp';
  };
}

// ============================================================================
// Errors
// ============================================================================

export class ApiError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const ErrorCodes = {
  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',

  // Nodes
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  NODE_ALREADY_EXISTS: 'NODE_ALREADY_EXISTS',
  NODE_ALREADY_INSTALLED: 'NODE_ALREADY_INSTALLED',
  AGENT_OFFLINE: 'AGENT_OFFLINE',

  // Clients
  CLIENT_NOT_FOUND: 'CLIENT_NOT_FOUND',
  CLIENT_ALREADY_EXISTS: 'CLIENT_ALREADY_EXISTS',
  INVALID_CLIENT_NAME: 'INVALID_CLIENT_NAME',

  // Agent
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  AGENT_VERSION_INCOMPATIBLE: 'AGENT_VERSION_INCOMPATIBLE',

  // Jobs
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  JOB_ALREADY_COMPLETED: 'JOB_ALREADY_COMPLETED',

  // Artifacts
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  ARTIFACT_EXPIRED: 'ARTIFACT_EXPIRED',

  // Generic
  INVALID_INPUT: 'INVALID_INPUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
