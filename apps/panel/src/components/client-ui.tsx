'use client';

// Shared presentation helpers for VPN clients, used by both the per-node clients
// table and the global Clients view.

/** Human-readable bytes (1024-based): 0 B, 12.3 MB, 4.7 GB … */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** "just now" / "5 min ago" / "3h ago" / "2d ago". */
export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Compact session duration since a start time: "<1m" / "45m" / "1h 23m" / "2d 4h". */
export function durationSince(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return '<1m';
}

export interface ClientActivity {
  online: boolean;
  connectedSince?: string | null;
  realAddress?: string | null;
  vpnAddress?: string | null;
  lastSeenAt?: string | null;
}

/** Live status + last-seen / current-session details. */
export function ActivityCell({ client }: { client: ClientActivity }) {
  if (client.online) {
    return (
      <div>
        <div className="flex items-center gap-1.5 font-medium text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Online now
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {client.connectedSince && <span>for {durationSince(client.connectedSince)}</span>}
          {client.realAddress && <span> · {client.realAddress}</span>}
          {client.vpnAddress && <span> · {client.vpnAddress}</span>}
        </div>
      </div>
    );
  }
  return client.lastSeenAt ? (
    <span className="text-sm text-muted-foreground" title={new Date(client.lastSeenAt).toLocaleString()}>
      Last seen {timeAgo(client.lastSeenAt)}
    </span>
  ) : (
    <span className="text-sm text-muted-foreground/60">Never connected</span>
  );
}

/** Expiry: the date the config stops working + a relative hint. */
export function ExpiryCell({ expiresAt, status }: { expiresAt?: string | null; status: string }) {
  if (!expiresAt) return <span className="text-muted-foreground">Never</span>;
  const d = new Date(expiresAt);
  const ms = d.getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  const expired = ms <= 0 || status === 'EXPIRED';
  const dateStr = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  let rel: string;
  let cls: string;
  if (expired) {
    rel = 'Expired — stopped working';
    cls = 'text-destructive';
  } else if (days <= 7) {
    rel = days <= 1 ? 'expires within a day' : `expires in ${days} days`;
    cls = 'text-yellow-400';
  } else {
    rel = `in ${days} days`;
    cls = 'text-muted-foreground';
  }
  return (
    <div>
      <div className={expired ? 'text-muted-foreground line-through' : 'text-foreground'}>{dateStr}</div>
      <div className={`text-xs ${cls}`}>{rel}</div>
    </div>
  );
}
