'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Search, Server } from 'lucide-react';

import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingState, Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatBytes, ActivityCell, ExpiryCell, ClientStatusDot } from '@/components/client-ui';
import { useClientActions } from '@/components/use-client-actions';
import { useSession } from '@/components/session-context';

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
  status?: string;
}

const EXPIRY_OPTIONS = [
  { value: '30', label: '1 month' },
  { value: '90', label: '3 months' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
  { value: 'never', label: 'Never' },
] as const;

const TH = 'px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase';
const SELECT = 'h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function ClientsPage() {
  const router = useRouter();
  const { isFullAdmin } = useSession();

  const [clients, setClients] = useState<Client[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [nodes, setNodes] = useState<NodeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [status, setStatus] = useState('');
  const [createdById, setCreatedById] = useState('');

  // Add-client dialog
  const [showAdd, setShowAdd] = useState(false);
  const [addNodeId, setAddNodeId] = useState('');
  const [addName, setAddName] = useState('');
  const [addExpiry, setAddExpiry] = useState('365');
  const [adding, setAdding] = useState(false);

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

  const { renderActions } = useClientActions(() => load(true));

  const healthyNodes = nodes.filter((n) => n.status === 'HEALTHY');

  const openAdd = () => {
    setAddName('');
    setAddExpiry('365');
    setAddNodeId(healthyNodes[0]?.id ?? '');
    setShowAdd(true);
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addNodeId) return;
    setAdding(true);
    try {
      await apiFetch(`/api/nodes/${addNodeId}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName, expiresIn: addExpiry === 'never' ? undefined : parseInt(addExpiry, 10) }),
      });
      toast({ variant: 'success', title: 'Client created', description: `${addName} — the .ovpn will be ready in a moment.` });
      setShowAdd(false);
      load(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) return router.push('/login');
      toast({ variant: 'destructive', title: 'Create failed', description: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setAdding(false);
    }
  };

  const onlineCount = clients.filter((c) => c.online).length;
  const hasFilters = !!(search || nodeId || status || createdById);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
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
        <Button className="gap-2" onClick={openAdd} disabled={nodes.length === 0}>
          <Plus className="h-4 w-4" />
          Add Client
        </Button>
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
        {/* Creator filter is only meaningful for full admins — managers only ever see their own clients. */}
        {isFullAdmin && (
          <select value={createdById} onChange={(e) => setCreatedById(e.target.value)} className={SELECT} aria-label="Filter by creator">
            <option value="">All creators</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>{c.email}</option>
            ))}
          </select>
        )}
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
                  <th scope="col" className={TH}>Activity</th>
                  <th scope="col" className={TH}>Traffic</th>
                  <th scope="col" className={TH}>Expires</th>
                  <th scope="col" className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map((c) => {
                  return (
                    <tr key={c.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <ClientStatusDot status={c.status} />
                          <span className="font-medium text-foreground">{c.name}</span>
                        </div>
                        {isFullAdmin && (
                          <div className="ml-[18px] mt-0.5 truncate text-xs text-muted-foreground">by {c.createdByEmail ?? 'unknown'}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-sm">
                        <Link href={`/dashboard/nodes/${c.nodeId}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                          <Server className="h-3.5 w-3.5" />
                          {c.nodeName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 align-top text-sm"><ActivityCell client={c} /></td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-sm">
                        <span className="text-emerald-400">↑ {formatBytes(c.bytesUp)}</span>
                        <span className="mx-1 text-muted-foreground">/</span>
                        <span className="text-blue-400">↓ {formatBytes(c.bytesDown)}</span>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-sm"><ExpiryCell expiresAt={c.expiresAt} status={c.status} /></td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">{renderActions(c, true)}</div>
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
              return (
                <div key={c.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ClientStatusDot status={c.status} />
                      <span className="truncate font-medium text-foreground">{c.name}</span>
                    </div>
                    {isFullAdmin && (
                      <div className="ml-[18px] truncate text-xs text-muted-foreground">by {c.createdByEmail ?? 'unknown'}</div>
                    )}
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
                  <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">{renderActions(c, false)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Create a client in one step — pick the node, name, and validity. */}
      <Dialog open={showAdd} onOpenChange={(o) => { if (!o && !adding) setShowAdd(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add client</DialogTitle>
            <DialogDescription>Create a new VPN user. The .ovpn becomes downloadable once the node issues the certificate.</DialogDescription>
          </DialogHeader>
          {healthyNodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No online node is available to add a client to right now.</p>
          ) : (
            <form id="add-client-form" onSubmit={submitAdd} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="add-node">Node</Label>
                <select id="add-node" value={addNodeId} onChange={(e) => setAddNodeId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  {healthyNodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">The client is created on this server.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-name">Client name</Label>
                <Input id="add-name" value={addName} onChange={(e) => setAddName(e.target.value)} required pattern="^[a-zA-Z0-9._-]+$" placeholder="e.g. user1, laptop, iphone-john" />
                <p className="text-xs text-muted-foreground">Letters, numbers, dots, underscores, hyphens.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-expiry">Expires in</Label>
                <select id="add-expiry" value={addExpiry} onChange={(e) => setAddExpiry(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {addExpiry !== 'never' && (
                  <p className="text-xs text-muted-foreground">
                    Valid until {new Date(Date.now() + parseInt(addExpiry, 10) * 86400000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.
                  </p>
                )}
              </div>
            </form>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowAdd(false)} disabled={adding}>Cancel</Button>
            {healthyNodes.length > 0 && (
              <Button form="add-client-form" type="submit" disabled={adding || !addNodeId} className="gap-2">
                {adding ? (<><Spinner className="h-4 w-4" />Creating…</>) : 'Create client'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
