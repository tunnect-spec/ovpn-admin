'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Power, PowerOff, Trash2, Download, Search, Server } from 'lucide-react';

import { apiFetch, apiFetchRaw, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { confirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/spinner';
import { getClientStatus } from '@/components/status-config';
import { formatBytes, ActivityCell, ExpiryCell } from '@/components/client-ui';

interface Client {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'EXPIRED';
  nodeId: string;
  nodeName: string;
  createdById: string | null;
  createdByEmail: string | null;
  createdAt: string;
  expiresAt?: string | null;
  lastSeenAt?: string | null;
  connectedSince?: string | null;
  realAddress?: string | null;
  vpnAddress?: string | null;
  bytesUp: number;
  bytesDown: number;
  online: boolean;
  artifactCount: number;
}
interface Creator {
  id: string;
  email: string;
}
interface NodeLite {
  id: string;
  name: string;
}

const TH = 'px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase';
const SELECT = 'h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function ClientsPage() {
  const router = useRouter();

  const [clients, setClients] = useState<Client[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [nodes, setNodes] = useState<NodeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [status, setStatus] = useState('');
  const [createdById, setCreatedById] = useState('');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        if (nodeId) params.set('nodeId', nodeId);
        if (status) params.set('status', status);
        if (createdById) params.set('createdById', createdById);
        const data = await apiFetch<{ clients: Client[]; creators: Creator[] }>(`/api/clients?${params.toString()}`);
        setClients(data.clients || []);
        setCreators(data.creators || []);
        if (silent) setError(null);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          router.push('/login');
          return;
        }
        if (!silent) {
          const message = err instanceof Error ? err.message : 'Failed to load clients';
          setError(message);
          toast({ variant: 'destructive', title: 'Failed to load clients', description: message });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [router, search, nodeId, status, createdById],
  );

  // Load node options once (for the node filter).
  useEffect(() => {
    apiFetch<{ nodes: NodeLite[] }>('/api/nodes?limit=100')
      .then((d) => setNodes(d.nodes || []))
      .catch(() => {});
  }, []);

  // Debounced reload on filter change.
  const firstRun = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => load(), firstRun.current ? 0 : 300);
    firstRun.current = false;
    return () => clearTimeout(t);
  }, [load]);

  // Silent auto-refresh.
  useEffect(() => {
    const t = setInterval(() => load(true), 20000);
    return () => clearInterval(t);
  }, [load]);

  const handleToggle = async (c: Client) => {
    const enabling = c.status === 'DISABLED';
    setBusyId(c.id);
    try {
      await apiFetch(`/api/clients/${c.id}/${enabling ? 'enable' : 'disable'}`, { method: 'POST' });
      toast({ variant: 'success', title: enabling ? 'Client enabled' : 'Client disabled', description: c.name });
      load(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) return router.push('/login');
      toast({ variant: 'destructive', title: 'Action failed', description: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (c: Client) => {
    const ok = await confirm({
      title: `Delete "${c.name}" permanently?`,
      description: 'The certificate is revoked on the node (its .ovpn can never reconnect) and the client is removed.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(c.id);
    try {
      await apiFetch(`/api/clients/${c.id}`, { method: 'DELETE' });
      toast({ variant: 'success', title: 'Client deleted', description: c.name });
      load(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) return router.push('/login');
      toast({ variant: 'destructive', title: 'Delete failed', description: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (c: Client) => {
    setDownloadingId(c.id);
    try {
      const res = await apiFetchRaw(`/api/clients/${c.id}/download`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${c.name}.ovpn`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ variant: 'success', title: 'Config downloaded', description: `${c.name}.ovpn` });
    } catch (err) {
      if (err instanceof UnauthorizedError) return router.push('/login');
      toast({ variant: 'destructive', title: 'Download failed', description: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setDownloadingId(null);
    }
  };

  const actions = (c: Client, iconOnly: boolean) => {
    const canDownload = (c.status === 'ACTIVE' || c.status === 'DISABLED') && c.artifactCount > 0;
    const canToggle = c.status === 'ACTIVE' || c.status === 'DISABLED';
    const canDelete = c.status !== 'REVOKED';
    const enabling = c.status === 'DISABLED';
    return (
      <>
        {canDownload && (
          <Button variant="outline" size={iconOnly ? 'icon' : 'sm'} className={iconOnly ? '' : 'gap-1.5'} onClick={() => handleDownload(c)} disabled={downloadingId === c.id} aria-label={`Download ${c.name}.ovpn`} title="Download .ovpn config">
            <Download className="h-4 w-4" />
            {!iconOnly && (downloadingId === c.id ? 'Downloading…' : 'Download')}
          </Button>
        )}
        {canToggle && (
          <Button variant="ghost" size={iconOnly ? 'icon' : 'sm'} className={iconOnly ? '' : 'gap-1.5'} onClick={() => handleToggle(c)} disabled={busyId === c.id} aria-label={enabling ? `Enable ${c.name}` : `Disable ${c.name}`} title={enabling ? 'Enable this client' : 'Temporarily block this client'}>
            {enabling ? <Power className="h-4 w-4 text-emerald-400" /> : <PowerOff className="h-4 w-4 text-yellow-400" />}
            {!iconOnly && (enabling ? 'Enable' : 'Disable')}
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" size={iconOnly ? 'icon' : 'sm'} className={`text-destructive hover:text-destructive hover:bg-destructive/10 ${iconOnly ? '' : 'gap-1.5'}`} onClick={() => handleDelete(c)} disabled={busyId === c.id} aria-label={`Delete ${c.name}`} title="Delete permanently">
            <Trash2 className="h-4 w-4" />
            {!iconOnly && 'Delete'}
          </Button>
        )}
      </>
    );
  };

  const onlineCount = clients.filter((c) => c.online).length;
  const hasFilters = !!(search || nodeId || status || createdById);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clients</h1>
        <p className="text-muted-foreground mt-1">
          All VPN clients across your nodes
          {clients.length > 0 && (
            <>
              {' · '}
              <span className="text-emerald-400 font-medium">{onlineCount} online</span>
              {' / '}
              {clients.length} shown
            </>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by client name…"
            className="pl-9"
            aria-label="Search clients"
          />
        </div>
        <select value={nodeId} onChange={(e) => setNodeId(e.target.value)} className={SELECT} aria-label="Filter by node">
          <option value="">All nodes</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
          <option value="REVOKED">Revoked</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <select value={createdById} onChange={(e) => setCreatedById(e.target.value)} className={SELECT} aria-label="Filter by creator">
          <option value="">All creators</option>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>{c.email}</option>
          ))}
        </select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setNodeId(''); setStatus(''); setCreatedById(''); }}>
            Clear
          </Button>
        )}
      </div>

      {loading && clients.length === 0 ? (
        <LoadingState label="Loading clients" />
      ) : error && clients.length === 0 ? (
        <ErrorState title="Couldn't load clients" message={error} onRetry={() => load()} retrying={loading} />
      ) : clients.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center text-muted-foreground">
          {hasFilters ? 'No clients match these filters.' : 'No clients yet. Create one from a node.'}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full">
              <caption className="sr-only">All VPN clients</caption>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>Client</th>
                  <th scope="col" className={TH}>Node</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}>Activity</th>
                  <th scope="col" className={TH}>Traffic</th>
                  <th scope="col" className={TH}>Expires</th>
                  <th scope="col" className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map((c) => {
                  const st = getClientStatus(c.status);
                  return (
                    <tr key={c.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${c.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} aria-label={c.online ? 'Online' : 'Offline'} />
                          <span className="font-medium text-foreground">{c.name}</span>
                        </div>
                        <div className="ml-4 mt-0.5 truncate text-xs text-muted-foreground">by {c.createdByEmail ?? 'unknown'}</div>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-sm">
                        <Link href={`/dashboard/nodes/${c.nodeId}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                          <Server className="h-3.5 w-3.5" />
                          {c.nodeName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap"><Badge variant={st.variant}>{st.label}</Badge></td>
                      <td className="px-4 py-3 align-top text-sm"><ActivityCell client={c} /></td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-sm">
                        <span className="text-emerald-400">↑ {formatBytes(c.bytesUp)}</span>
                        <span className="mx-1 text-muted-foreground">/</span>
                        <span className="text-blue-400">↓ {formatBytes(c.bytesDown)}</span>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-sm"><ExpiryCell expiresAt={c.expiresAt} status={c.status} /></td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">{actions(c, true)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {clients.map((c) => {
              const st = getClientStatus(c.status);
              return (
                <div key={c.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${c.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} aria-label={c.online ? 'Online' : 'Offline'} />
                        <span className="truncate font-medium text-foreground">{c.name}</span>
                      </div>
                      <div className="ml-4 truncate text-xs text-muted-foreground">by {c.createdByEmail ?? 'unknown'}</div>
                    </div>
                    <Badge variant={st.variant} className="shrink-0">{st.label}</Badge>
                  </div>
                  <ActivityCell client={c} />
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">Node</dt>
                    <dd className="text-right">
                      <Link href={`/dashboard/nodes/${c.nodeId}`} className="text-foreground hover:underline">{c.nodeName}</Link>
                    </dd>
                    <dt className="text-muted-foreground">Traffic</dt>
                    <dd className="text-right">
                      <span className="text-emerald-400">↑ {formatBytes(c.bytesUp)}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-blue-400">↓ {formatBytes(c.bytesDown)}</span>
                    </dd>
                    <dt className="text-muted-foreground">Expires</dt>
                    <dd className="text-right"><ExpiryCell expiresAt={c.expiresAt} status={c.status} /></dd>
                  </dl>
                  <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">{actions(c, false)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
