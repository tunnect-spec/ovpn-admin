'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/spinner';
import { formatBytes, ActivityCell, ExpiryCell, ClientStatusDot } from '@/components/client-ui';
import { useClientActions } from '@/components/use-client-actions';
import { useSession } from '@/components/session-context';

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


  const { isFullAdmin } = useSession();
  const { renderActions } = useClientActions(() => load(true));

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
                  return (
                    <tr key={client.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <ClientStatusDot status={client.status} />
                          <span className="font-medium text-foreground">{client.name}</span>
                        </div>
                        {isFullAdmin && (
                          <div className="ml-[18px] mt-0.5 truncate text-xs text-muted-foreground">
                            by {client.createdByEmail ?? 'unknown'}
                          </div>
                        )}
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
              return (
                <div key={client.id} className="space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ClientStatusDot status={client.status} />
                      <span className="truncate font-medium text-foreground">{client.name}</span>
                    </div>
                    {isFullAdmin && (
                      <div className="ml-[18px] truncate text-xs text-muted-foreground">
                        by {client.createdByEmail ?? 'unknown'}
                      </div>
                    )}
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
