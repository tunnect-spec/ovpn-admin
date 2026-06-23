'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/spinner';

interface AuditLog {
  id: string;
  adminEmail: string | null;
  nodeName: string | null;
  clientName: string | null;
  action: string;
  ipAddress: string | null;
  createdAt: string;
}

const TH = 'px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap';

export default function AuditPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ logs: AuditLog[] }>('/api/audit-logs');
      setLogs(data.logs || []);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to load audit logs';
      setError(message);
      toast({ variant: 'destructive', title: 'Failed to load audit logs', description: message });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Audit Logs</h2>
        <p className="text-muted-foreground mt-1">System activity history</p>
      </div>

      {loading ? (
        <LoadingState label="Loading audit logs" />
      ) : error && logs.length === 0 ? (
        <ErrorState
          title="Couldn't load audit logs"
          message={error}
          onRetry={load}
          retrying={loading}
        />
      ) : logs.length === 0 ? (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-12 text-center">
          <p className="text-muted-foreground">No activity yet</p>
        </div>
      ) : (
        <div className="bg-card text-card-foreground border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">Administrative activity log</caption>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>Timestamp</th>
                  <th scope="col" className={TH}>Admin</th>
                  <th scope="col" className={TH}>Action</th>
                  <th scope="col" className={TH}>Node</th>
                  <th scope="col" className={TH}>Client</th>
                  <th scope="col" className={TH}>IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{log.adminEmail || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">{log.action}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{log.nodeName || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{log.clientName || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {log.ipAddress || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
