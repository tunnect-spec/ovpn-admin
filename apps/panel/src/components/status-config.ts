import {
  Clock,
  Activity,
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Ban,
  type LucideIcon,
} from 'lucide-react';

import type { BadgeProps } from '@/components/ui/badge';

export type BadgeVariant = NonNullable<BadgeProps['variant']>;

export interface StatusEntry {
  /** Badge variant from the shared <Badge> primitive. */
  variant: BadgeVariant;
  /** Human-readable label. */
  label: string;
  /** Lucide icon to render alongside the label. */
  icon: LucideIcon;
  /** Solid dot color (Tailwind bg-* class) for inline status dots. */
  dot: string;
  /** Foreground text color (Tailwind text-* class). */
  text: string;
}

// ---------------------------------------------------------------------------
// Node statuses
// ---------------------------------------------------------------------------

export type NodeStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'HEALTHY'
  | 'UNHEALTHY'
  | 'ERROR';

export const NODE_STATUS: Record<NodeStatus, StatusEntry> = {
  PENDING: {
    variant: 'secondary',
    label: 'Pending Agent',
    icon: Clock,
    dot: 'bg-muted-foreground',
    text: 'text-muted-foreground',
  },
  PROVISIONING: {
    variant: 'default',
    label: 'Installing',
    icon: Activity,
    dot: 'bg-blue-500',
    text: 'text-blue-400',
  },
  HEALTHY: {
    variant: 'success',
    label: 'Healthy',
    icon: Shield,
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
  },
  UNHEALTHY: {
    variant: 'warning',
    label: 'Unhealthy',
    icon: AlertTriangle,
    dot: 'bg-yellow-500',
    text: 'text-yellow-400',
  },
  ERROR: {
    variant: 'destructive',
    label: 'Error',
    icon: XCircle,
    dot: 'bg-destructive',
    text: 'text-destructive',
  },
};

export function getNodeStatus(status: string): StatusEntry {
  return NODE_STATUS[status as NodeStatus] ?? NODE_STATUS.PENDING;
}

// ---------------------------------------------------------------------------
// Client statuses
// ---------------------------------------------------------------------------

export type ClientStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export const CLIENT_STATUS: Record<ClientStatus, StatusEntry> = {
  ACTIVE: {
    variant: 'success',
    label: 'Active',
    icon: CheckCircle2,
    dot: 'bg-emerald-500',
    text: 'text-success',
  },
  REVOKED: {
    variant: 'destructive',
    label: 'Revoked',
    icon: Ban,
    dot: 'bg-destructive',
    text: 'text-error',
  },
  EXPIRED: {
    variant: 'secondary',
    label: 'Expired',
    icon: Clock,
    dot: 'bg-muted-foreground',
    text: 'text-muted-foreground',
  },
};

export function getClientStatus(status: string): StatusEntry {
  return CLIENT_STATUS[status as ClientStatus] ?? CLIENT_STATUS.EXPIRED;
}

// ---------------------------------------------------------------------------
// Job statuses
// ---------------------------------------------------------------------------

export type JobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export const JOB_STATUS: Record<JobStatus, StatusEntry> = {
  PENDING: {
    variant: 'secondary',
    label: 'Pending',
    icon: Clock,
    dot: 'bg-muted-foreground',
    text: 'text-muted-foreground',
  },
  RUNNING: {
    variant: 'default',
    label: 'Running',
    icon: Loader2,
    dot: 'bg-primary',
    text: 'text-primary',
  },
  COMPLETED: {
    variant: 'success',
    label: 'Completed',
    icon: CheckCircle2,
    dot: 'bg-emerald-500',
    text: 'text-emerald-500',
  },
  FAILED: {
    variant: 'destructive',
    label: 'Failed',
    icon: XCircle,
    dot: 'bg-destructive',
    text: 'text-destructive',
  },
  CANCELLED: {
    variant: 'secondary',
    label: 'Cancelled',
    icon: Ban,
    dot: 'bg-muted-foreground',
    text: 'text-muted-foreground',
  },
};

export function getJobStatus(status: string): StatusEntry {
  return JOB_STATUS[status as JobStatus] ?? JOB_STATUS.PENDING;
}

/** Terminal job states — polling should stop once one of these is reached. */
export const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
