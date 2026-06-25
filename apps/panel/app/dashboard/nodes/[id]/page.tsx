'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Copy, Plus, Trash2, MoveRight } from 'lucide-react';

import { InstallNodeDialog } from './InstallNodeDialog';
import { apiFetch, ApiError, UnauthorizedError } from '@/components/use-api';
import { useSession } from '@/components/session-context';
import { copyToClipboard } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { confirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/spinner';
import { getNodeStatus } from '@/components/status-config';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface NodeMetadata {
  os?: string;
  arch?: string;
}

interface NodeDetails {
  id: string;
  name: string;
  host: string;
  status: string;
  version: string | null;
  openvpnVersion: string | null;
  metadata?: NodeMetadata | null;
  xorMask: string | null;
  protocol?: string | null;
  ovpnPort?: number | null;
  obfuscation?: string | null;
  cipher?: string | null;
  authDigest?: string | null;
  tunnelMode?: string | null;
  clientToClient?: boolean | null;
  duplicateCn?: boolean | null;
  domain?: string | null;
  dnsServers?: string[] | null;
  mtu?: number | null;
  mssfix?: number | null;
  lastHeartbeatAt: string | null;
  installedAt: string | null;
  createdAt: string;
  healthStatus: {
    status: string;
    details: {
      connectedClients?: number;
      cpu?: number;
      memory?: number;
      memoryUsedMb?: number;
      memoryTotalMb?: number;
      disk?: number;
      diskUsedGb?: number;
      diskTotalGb?: number;
      uptime?: number;
      loadAvg?: number[];
    };
    checkedAt: string;
  } | null;
}

const OBFUSCATION_LABELS: Record<string, string> = {
  none: 'None',
  xormask: 'XOR mask',
  xorptrpos: 'XOR position',
  reverse: 'Reverse',
  obfuscate: 'Obfuscate (compound)',
};

export default function NodeDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { isFullAdmin } = useSession();
  const nodeId = typeof params.id === 'string' ? params.id : '';

  const [node, setNode] = useState<NodeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [showMigrateDialog, setShowMigrateDialog] = useState(false);
  const [migrateToken, setMigrateToken] = useState('');
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState('');
  // True only while an actual NODE_INSTALL job is pending/running, so a freshly
  // attached node (PROVISIONING but no install yet) doesn't show a misleading
  // "Installing 0%" bar.
  const [installActive, setInstallActive] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadNode = useCallback(
    async (signal?: AbortSignal, background = false): Promise<void> => {
      if (!background) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await apiFetch<{ node: NodeDetails }>(
          `/api/nodes/${nodeId}`,
          signal ? { signal } : undefined,
        );
        if (!mountedRef.current) return;
        setNode(data.node);
        setError(null);
      } catch (err) {
        if (signal?.aborted || !mountedRef.current) return;
        if (err instanceof UnauthorizedError) {
          router.push('/login');
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          router.push('/dashboard/nodes');
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load node';
        if (!background) {
          setError(message);
          toast({ variant: 'destructive', title: 'Failed to load node', description: message });
        }
      } finally {
        if (!background && mountedRef.current) setLoading(false);
      }
    },
    [nodeId, router],
  );

  // Initial load + 10s background refresh (self-scheduling, never overlaps).
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        await loadNode(controller.signal, true);
        schedule();
      }, 10000);
    };

    loadNode(controller.signal).then(schedule);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [loadNode]);

  // Install-progress poll while PROVISIONING (2s, self-scheduling).
  useEffect(() => {
    if (node?.status !== 'PROVISIONING') return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await apiFetch<{ progress?: number; message?: string; status?: string }>(
          `/api/nodes/${nodeId}/install-progress`,
          { signal: controller.signal },
        );
        if (cancelled) return;
        setInstallProgress(data.progress ?? 0);
        setInstallMessage(data.message ?? '');
        setInstallActive(data.status === 'PENDING' || data.status === 'RUNNING');
        if (data.status && data.status !== 'PENDING') {
          loadNode(controller.signal, true);
        }
      } catch {
        if (controller.signal.aborted) return;
        // transient — keep polling
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };

    poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [node?.status, nodeId, loadNode]);

  const handleDelete = async () => {
    if (!node) return;
    const ok = await confirm({
      title: `Delete node "${node.name}"?`,
      description: 'This removes the node from the panel. Nodes with active clients cannot be deleted.',
      confirmLabel: 'Delete node',
      destructive: true,
    });
    if (!ok) return;

    try {
      await apiFetch(`/api/nodes/${nodeId}`, { method: 'DELETE' });
      toast({ variant: 'success', title: 'Node deleted' });
      router.push('/dashboard/nodes');
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to delete node';
      toast({ variant: 'destructive', title: 'Failed to delete node', description: message });
    }
  };

  const handleMigrate = async () => {
    const ok = await confirm({
      title: 'Migrate this server?',
      description:
        'This invalidates the current agent and issues a fresh registration token so you can move this node (and its PKI) to a new server. Existing clients keep working after migration.',
      confirmLabel: 'Generate migration command',
      destructive: true,
    });
    if (!ok) return;

    try {
      const data = await apiFetch<{ token: string }>(`/api/nodes/${nodeId}/migrate-token`, { method: 'POST' });
      setMigrateToken(data.token);
      setShowMigrateDialog(true);
      loadNode();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to generate migration token';
      toast({ variant: 'destructive', title: 'Migration failed', description: message });
    }
  };

  const migrateCommand = `curl -fsSL ${origin}/api/agent/install.sh | AGENT_TOKEN=${migrateToken} PANEL_URL=${origin} bash`;

  const copyMigrate = async () => {
    if (await copyToClipboard(migrateCommand)) {
      toast({ variant: 'success', title: 'Command copied' });
    } else {
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Select the command and copy it manually.' });
    }
  };

  if (loading && !node) {
    return <LoadingState label="Loading node" />;
  }

  if (error && !node) {
    return <ErrorState title="Couldn't load node" message={error} onRetry={() => loadNode()} retrying={loading} />;
  }

  if (!node) {
    return <ErrorState title="Node not found" message="This node no longer exists." onRetry={() => router.push('/dashboard/nodes')} />;
  }

  const status = getNodeStatus(node.status);
  const StatusIcon = status.icon;
  // Show the install action whenever the agent is connected but OpenVPN isn't
  // installed yet — including recovery from a transient ERROR/UNHEALTHY before
  // the first successful install. Once installed (HEALTHY / installedAt set),
  // hide it; re-provisioning is a separate flow.
  const isInstalled = node.status === 'HEALTHY' || !!node.installedAt;
  const agentConnected =
    !!node.lastHeartbeatAt && Date.now() - new Date(node.lastHeartbeatAt).getTime() < 5 * 60 * 1000;
  // Node lifecycle (install/reconfigure/migrate/delete) is full-admin only.
  const canInstall = !isInstalled && isFullAdmin;
  // Reconfigure applies new options to an already-installed node (fast path).
  const canReconfigure = isInstalled && agentConnected && isFullAdmin;
  // A node that's connected and not installed, with no install running yet.
  const awaitingInstall = !isInstalled && !installActive;
  const canAddClient = node.status === 'HEALTHY';

  // Derive the dialog's DNS selection from the node's stored dnsServers so a
  // reconfigure pre-fills it (otherwise it silently resets DNS to "standard").
  const ds = node.dnsServers ?? [];
  const dnsMode: 'standard' | 'empty' | 'custom' =
    ds.length === 0
      ? 'empty'
      : ds.length === 2 && ds.includes('8.8.8.8') && ds.includes('1.1.1.1')
        ? 'standard'
        : 'custom';
  const customDns = dnsMode === 'custom' ? ds.join(', ') : undefined;

  return (
    <div className="space-y-6">
      {showInstallDialog && (
        <InstallNodeDialog
          nodeId={node.id}
          defaultHost={node.host}
          defaults={{
            protocol: (node.protocol as 'udp' | 'tcp') ?? undefined,
            port: node.ovpnPort ?? undefined,
            obfuscation: (node.obfuscation as 'none' | 'xormask' | 'xorptrpos' | 'reverse' | 'obfuscate') ?? undefined,
            cipher: (node.cipher as 'AES-256-GCM' | 'AES-128-GCM' | 'CHACHA20-POLY1305') ?? undefined,
            auth: (node.authDigest as 'SHA256' | 'SHA512') ?? undefined,
            tunnelMode: (node.tunnelMode as 'full' | 'split') ?? undefined,
            clientToClient: node.clientToClient ?? undefined,
            duplicateCn: node.duplicateCn ?? undefined,
            domain: node.domain ?? undefined,
            dnsMode,
            customDns,
            mtu: node.mtu ?? undefined,
            mssfix: node.mssfix ?? undefined,
          }}
          onClose={() => setShowInstallDialog(false)}
          onSuccess={() => {
            setShowInstallDialog(false);
            loadNode();
          }}
        />
      )}

      <Dialog open={showMigrateDialog} onOpenChange={setShowMigrateDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Migrate Server</DialogTitle>
            <DialogDescription>
              Run this on your <strong>new</strong> empty Ubuntu server. It installs the agent, links it to this node,
              and restores all PKI keys so existing clients keep working.
            </DialogDescription>
          </DialogHeader>
          <div className="relative rounded-md bg-black/50 p-3">
            <code className="block break-all pr-10 text-xs text-emerald-400 select-all">{migrateCommand}</code>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy migration command"
              className="absolute right-1.5 top-1.5 h-7 w-7"
              onClick={copyMigrate}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMigrateDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{node.name}</h2>
            <Badge variant={status.variant} className="gap-1">
              <StatusIcon className="h-3 w-3" aria-hidden="true" />
              {status.label}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">{node.host}</p>
        </div>
        <div className="flex gap-2">
          {canInstall && (
            <Button onClick={() => setShowInstallDialog(true)}>Install OpenVPN</Button>
          )}
          {canAddClient && (
            <Button asChild className="gap-2">
              <Link href={`/dashboard/nodes/${nodeId}/clients/new`}>
                <Plus className="h-4 w-4" />
                Add Client
              </Link>
            </Button>
          )}
        </div>
      </div>

      {isFullAdmin && installActive && (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-6">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-lg">Installing OpenVPN</h3>
            <span className="text-sm font-medium">{installProgress}%</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{installMessage || 'Please wait…'}</p>
          <div
            className="w-full bg-secondary rounded-full h-3 overflow-hidden"
            role="progressbar"
            aria-valuenow={installProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="bg-primary h-3 rounded-full transition-all duration-500 ease-out" style={{ width: `${installProgress}%` }} />
          </div>
        </div>
      )}

      {isFullAdmin && awaitingInstall && (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-6">
          <h3 className="font-semibold text-lg mb-1">
            {agentConnected ? 'Agent connected — ready to install' : 'Waiting for the agent to connect…'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {agentConnected
              ? 'The node is registered and its agent is online. Click “Install OpenVPN” to provision OpenVPN with your chosen options (XOR / DNS / domain / MTU).'
              : 'Run the install command on the server. Once the agent checks in, you can install OpenVPN here.'}
          </p>
        </div>
      )}

      {/* Server internals — only useful to full admins; managers just manage clients. */}
      {isFullAdmin && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <DetailCard label="Host / IP" value={node.host} />
        <DetailCard label="Agent Version" value={node.version || '-'} />
        <DetailCard label="OpenVPN" value={node.openvpnVersion || '-'} />
        <DetailCard label="System" value={node.metadata ? `${node.metadata.os || 'Unknown OS'} (${node.metadata.arch || 'Unknown Arch'})` : '-'} />
        <DetailCard label="Last Heartbeat" value={node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt).toLocaleString() : 'Never'} />
        <DetailCard label="Created" value={new Date(node.createdAt).toLocaleString()} />
      </div>
      )}

      {isFullAdmin && (isInstalled || node.status === 'PROVISIONING') && node.obfuscation && (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Server Configuration</h3>
            {canReconfigure && (
              <Button variant="outline" size="sm" onClick={() => setShowInstallDialog(true)}>Reconfigure</Button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <DetailCard label="Obfuscation" value={OBFUSCATION_LABELS[node.obfuscation] ?? node.obfuscation} />
            <DetailCard label="Transport" value={`${(node.protocol ?? 'udp').toUpperCase()} / ${node.ovpnPort ?? 443}`} />
            <DetailCard label="Cipher" value={node.cipher ?? '-'} />
            <DetailCard label="Auth" value={node.authDigest ?? '-'} />
            <DetailCard label="Routing" value={node.tunnelMode === 'split' ? 'Split tunnel' : 'Full tunnel'} />
            <DetailCard label="Client-to-client" value={node.clientToClient ? 'On' : 'Off'} />
            <DetailCard label="Multiple devices/cert" value={node.duplicateCn ? 'On' : 'Off'} />
            <DetailCard label="DNS" value={node.dnsServers && node.dnsServers.length ? node.dnsServers.join(', ') : 'Not pushed'} />
            <DetailCard label="MTU / MSSFIX" value={`${node.mtu ?? 1500} / ${node.mssfix ?? 1360}`} />
            <DetailCard label="Client remote" value={node.domain || node.host} />
          </div>
        </div>
      )}

      {/* Live server load — useful to admins and managers alike. */}
      {node.healthStatus && node.status === 'HEALTHY' && (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Health Status</h3>
          {(() => {
            const d = node.healthStatus.details;
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <MetricCard label="Connected Clients" value={d.connectedClients ?? 0} />
                <MetricCard label="CPU" value={d.cpu != null ? `${d.cpu.toFixed(1)}%` : '-'} />
                <MetricCard
                  label="Memory"
                  value={d.memory != null ? `${d.memory.toFixed(1)}%` : '-'}
                  sub={d.memoryUsedMb != null && d.memoryTotalMb != null ? `${fmtMb(d.memoryUsedMb)} / ${fmtMb(d.memoryTotalMb)}` : undefined}
                />
                <MetricCard
                  label="Disk"
                  value={d.disk != null ? `${d.disk}%` : '-'}
                  sub={d.diskUsedGb != null && d.diskTotalGb != null ? `${d.diskUsedGb} / ${d.diskTotalGb} GB` : undefined}
                />
                <MetricCard label="Uptime" value={formatUptime(d.uptime)} />
                <MetricCard label="Load avg" value={d.loadAvg && d.loadAvg.length ? d.loadAvg.map((n) => n.toFixed(2)).join('  ') : '-'} />
              </div>
            );
          })()}
          {isFullAdmin && node.xorMask && (
            <div className="mt-4 pt-4 border-t border-border">
              <span className="text-sm text-muted-foreground">XOR Mask:</span>
              <code className="ml-2 text-xs">{node.xorMask}</code>
            </div>
          )}
        </div>
      )}

      <div className="bg-card text-card-foreground border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="secondary">
            <Link href={`/dashboard/nodes/${nodeId}/clients`}>View Clients</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/dashboard/jobs?nodeId=${nodeId}`}>View Jobs</Link>
          </Button>
          {isFullAdmin && (
            <>
              <Button variant="destructive" onClick={handleDelete} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Delete Node
              </Button>
              <Button
                variant="outline"
                onClick={handleMigrate}
                className="gap-2 ml-auto border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                title="Move this node and its clients to a new physical server"
              >
                <MoveRight className="h-4 w-4" />
                Migrate Server
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted text-muted-foreground border border-border rounded-lg p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium text-foreground break-words">{value}</div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground/70">{sub}</div>}
    </div>
  );
}

/** Seconds → "3d 4h" / "5h 12m" / "12m" / "-". */
function formatUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** MB → "512 MB" / "3.4 GB". */
function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
