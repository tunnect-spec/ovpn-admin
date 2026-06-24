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

interface Client {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'EXPIRED';
  fingerprint: string;
  createdAt: string;
  revokedAt: string | null;
  disabledAt?: string | null;
  expiresAt?: string | null;
  bytesUp: number;
  bytesDown: number;
  online: boolean;
  artifactCount: number;
}

const TH = 'px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase';

/** Expiry cell: shows the date the config stops working + a relative hint. */
function ExpiryCell({ expiresAt, status }: { expiresAt?: string | null; status: string }) {
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

/** Human-readable bytes (1024-based): 0 B, 12.3 MB, 4.7 GB … */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function NodeClientsPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = typeof params.id === 'string' ? params.id : '';

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ clients: Client[] }>(`/api/nodes/${nodeId}/clients`);
      setClients(data.clients || []);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to load clients';
      setError(message);
      toast({ variant: 'destructive', title: 'Failed to load clients', description: message });
    } finally {
      setLoading(false);
    }
  }, [nodeId, router]);

  useEffect(() => {
    load();
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Clients</h2>
          <p className="text-muted-foreground mt-1">Manage VPN client configurations</p>
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
        <div className="bg-card text-card-foreground border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">VPN clients for this node</caption>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>Name</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}>Traffic (↑ up / ↓ down)</th>
                  <th scope="col" className={TH}>Created</th>
                  <th scope="col" className={TH}>Expires</th>
                  <th scope="col" className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map((client) => {
                  const status = getClientStatus(client.status);
                  return (
                    <tr key={client.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${client.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                            title={client.online ? 'Online' : 'Offline'}
                            aria-label={client.online ? 'Online' : 'Offline'}
                          />
                          <span className="font-medium text-foreground">{client.name}</span>
                        </div>
                        <div className="ml-4 text-xs text-muted-foreground font-mono">
                          {client.fingerprint.slice(0, 16)}…
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className="text-emerald-400">↑ {formatBytes(client.bytesUp)}</span>
                        <span className="mx-1.5 text-muted-foreground">/</span>
                        <span className="text-blue-400">↓ {formatBytes(client.bytesDown)}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {new Date(client.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <ExpiryCell expiresAt={client.expiresAt} status={client.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex justify-end gap-2">
                          {(client.status === 'ACTIVE' || client.status === 'DISABLED') && client.artifactCount > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => handleDownload(client.id, client.name)}
                              disabled={downloadingId === client.id}
                            >
                              <Download className="h-4 w-4" />
                              {downloadingId === client.id ? 'Downloading…' : 'Download'}
                            </Button>
                          )}
                          {(client.status === 'ACTIVE' || client.status === 'DISABLED') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => handleToggle(client)}
                              disabled={busyId === client.id}
                              title={client.status === 'DISABLED' ? 'Enable this client' : 'Temporarily block this client'}
                            >
                              {client.status === 'DISABLED' ? (
                                <><Power className="h-4 w-4 text-emerald-400" />Enable</>
                              ) : (
                                <><PowerOff className="h-4 w-4 text-yellow-400" />Disable</>
                              )}
                            </Button>
                          )}
                          {client.status !== 'REVOKED' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${client.name}`}
                              title="Delete permanently"
                              onClick={() => handleDelete(client.id, client.name)}
                              disabled={busyId === client.id}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
