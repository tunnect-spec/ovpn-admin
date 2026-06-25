'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Power, PowerOff, Trash2, Download } from 'lucide-react';

import { apiFetch, apiFetchRaw, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { confirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/spinner';
import { getClientStatus } from '@/components/status-config';
import { formatBytes, ActivityCell, ExpiryCell } from '@/components/client-ui';

interface Client {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'EXPIRED';
  fingerprint: string;
  createdAt: string;
  createdByEmail?: string | null;
  revokedAt: string | null;
  disabledAt?: string | null;
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

const TH = 'px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase';

export default function NodeClientsPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = typeof params.id === 'string' ? params.id : '';

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await apiFetch<{ clients: Client[] }>(`/api/nodes/${nodeId}/clients`);
      setClients(data.clients || []);
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
  }, [nodeId, router]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep online status / last-seen fresh without a manual reload (~20s, silent).
  useEffect(() => {
    const t = setInterval(() => load(true), 20000);
    return () => clearInterval(t);
  }, [load]);

  const [busyId, setBusyId] = useState<string | null>(null);

  const handleToggle = async (client: Client) => {
    const enabling = client.status === 'DISABLED';
    setBusyId(client.id);
    try {
      await apiFetch(`/api/clients/${client.id}/${enabling ? 'enable' : 'disable'}`, { method: 'POST' });
      toast({
        variant: 'success',
        title: enabling ? 'Client enabled' : 'Client disabled',
        description: client.name,
      });
      load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Action failed';
      toast({ variant: 'destructive', title: enabling ? 'Failed to enable' : 'Failed to disable', description: message });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (clientId: string, clientName: string) => {
    const ok = await confirm({
      title: `Delete "${clientName}" permanently?`,
      description:
        'The certificate is revoked on the node (its .ovpn can never reconnect) and the client is removed from the panel. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;

    setBusyId(clientId);
    try {
      await apiFetch(`/api/clients/${clientId}`, { method: 'DELETE' });
      toast({ variant: 'success', title: 'Client deleted', description: clientName });
      load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to delete client';
      toast({ variant: 'destructive', title: 'Failed to delete client', description: message });
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (clientId: string, clientName: string) => {
    setDownloadingId(clientId);
    try {
      const res = await apiFetchRaw(`/api/clients/${clientId}/download`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clientName}.ovpn`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ variant: 'success', title: 'Config downloaded', description: `${clientName}.ovpn` });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to download config';
      toast({ variant: 'destructive', title: 'Download failed', description: message });
    } finally {
      setDownloadingId(null);
    }
  };

  // Row actions, shared by the desktop table (icon-only, compact) and the mobile
  // cards (icon + label). One source of truth so behaviour can't drift.
  const renderActions = (client: Client, iconOnly: boolean) => {
    const canDownload = (client.status === 'ACTIVE' || client.status === 'DISABLED') && client.artifactCount > 0;
    const canToggle = client.status === 'ACTIVE' || client.status === 'DISABLED';
    const canDelete = client.status !== 'REVOKED';
    const enabling = client.status === 'DISABLED';
    return (
      <>
        {canDownload && (
          <Button
            variant="outline"
            size={iconOnly ? 'icon' : 'sm'}
            className={iconOnly ? '' : 'gap-1.5'}
            onClick={() => handleDownload(client.id, client.name)}
            disabled={downloadingId === client.id}
            aria-label={`Download ${client.name}.ovpn`}
            title="Download .ovpn config"
          >
            <Download className="h-4 w-4" />
            {!iconOnly && (downloadingId === client.id ? 'Downloading…' : 'Download')}
          </Button>
        )}
        {canToggle && (
          <Button
            variant="ghost"
            size={iconOnly ? 'icon' : 'sm'}
            className={iconOnly ? '' : 'gap-1.5'}
            onClick={() => handleToggle(client)}
            disabled={busyId === client.id}
            aria-label={enabling ? `Enable ${client.name}` : `Disable ${client.name}`}
            title={enabling ? 'Enable this client' : 'Temporarily block this client'}
          >
            {enabling ? <Power className="h-4 w-4 text-emerald-400" /> : <PowerOff className="h-4 w-4 text-yellow-400" />}
            {!iconOnly && (enabling ? 'Enable' : 'Disable')}
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size={iconOnly ? 'icon' : 'sm'}
            className={`text-destructive hover:text-destructive hover:bg-destructive/10 ${iconOnly ? '' : 'gap-1.5'}`}
            onClick={() => handleDelete(client.id, client.name)}
            disabled={busyId === client.id}
            aria-label={`Delete ${client.name}`}
            title="Delete permanently"
          >
            <Trash2 className="h-4 w-4" />
            {!iconOnly && 'Delete'}
          </Button>
        )}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Clients</h2>
          <p className="text-muted-foreground mt-1">
            Manage VPN client configurations
            {clients.length > 0 && (
              <>
                {' · '}
                <span className="text-emerald-400 font-medium">{clients.filter((c) => c.online).length} online</span>
                {' / '}
                {clients.length} total
              </>
            )}
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link href={`/dashboard/nodes/${nodeId}/clients/new`}>
            <Plus className="h-4 w-4" />
            Add Client
          </Link>
        </Button>
      </div>

      {loading && clients.length === 0 ? (
        <LoadingState label="Loading clients" />
      ) : error && clients.length === 0 ? (
        <ErrorState title="Couldn't load clients" message={error} onRetry={load} retrying={loading} />
      ) : clients.length === 0 ? (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-12 text-center">
          <p className="text-muted-foreground mb-4">No clients have been created yet.</p>
          <Button asChild>
            <Link href={`/dashboard/nodes/${nodeId}/clients/new`}>Add Your First Client</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Desktop (lg+): compact table — everything fits, no horizontal scroll. */}
          <div className="hidden lg:block bg-card text-card-foreground border border-border rounded-lg overflow-hidden">
            <table className="w-full table-auto">
              <caption className="sr-only">VPN clients for this node</caption>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>Client</th>
                  <th scope="col" className={TH}>Activity</th>
                  <th scope="col" className={TH}>Traffic</th>
                  <th scope="col" className={TH}>Expires</th>
                  <th scope="col" className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map((client) => {
                  const status = getClientStatus(client.status);
                  return (
                    <tr key={client.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${client.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                            title={client.online ? 'Online' : 'Offline'}
                            aria-label={client.online ? 'Online' : 'Offline'}
                          />
                          <span className="font-medium text-foreground">{client.name}</span>
                          <Badge variant={status.variant} className="ml-1">{status.label}</Badge>
                        </div>
                        <div className="ml-4 mt-0.5 truncate text-xs text-muted-foreground">
                          by {client.createdByEmail ?? 'unknown'}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-sm">
                        <ActivityCell client={client} />
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-sm">
                        <span className="text-emerald-400">↑ {formatBytes(client.bytesUp)}</span>
                        <span className="mx-1 text-muted-foreground">/</span>
                        <span className="text-blue-400">↓ {formatBytes(client.bytesDown)}</span>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-sm">
                        <ExpiryCell expiresAt={client.expiresAt} status={client.status} />
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">{renderActions(client, true)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet (<lg): cards — no horizontal scroll, everything stacked. */}
          <div className="space-y-3 lg:hidden">
            {clients.map((client) => {
              const status = getClientStatus(client.status);
              return (
                <div key={client.id} className="space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${client.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                          aria-label={client.online ? 'Online' : 'Offline'}
                        />
                        <span className="truncate font-medium text-foreground">{client.name}</span>
                      </div>
                      <div className="ml-4 truncate text-xs text-muted-foreground">
                        by {client.createdByEmail ?? 'unknown'}
                      </div>
                    </div>
                    <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
                  </div>

                  <ActivityCell client={client} />

                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">Traffic</dt>
                    <dd className="text-right">
                      <span className="text-emerald-400">↑ {formatBytes(client.bytesUp)}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-blue-400">↓ {formatBytes(client.bytesDown)}</span>
                    </dd>
                    <dt className="text-muted-foreground">Expires</dt>
                    <dd className="text-right"><ExpiryCell expiresAt={client.expiresAt} status={client.status} /></dd>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="text-right text-muted-foreground">{new Date(client.createdAt).toLocaleDateString()}</dd>
                  </dl>

                  <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
                    {renderActions(client, false)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
