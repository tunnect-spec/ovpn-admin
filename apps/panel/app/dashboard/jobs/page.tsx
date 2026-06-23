'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { confirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/spinner';
import { getJobStatus } from '@/components/status-config';

interface Job {
  id: string;
  type: 'NODE_INSTALL' | 'CLIENT_CREATE' | 'CLIENT_REVOKE' | 'NODE_SYNC' | 'HEALTH_CHECK';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  nodeName: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

const TH = 'px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase';

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ jobs: Job[] }>('/api/jobs');
      setJobs(data.jobs || []);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to load jobs';
      setError(message);
      toast({ variant: 'destructive', title: 'Failed to load jobs', description: message });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCancel = async (jobId: string) => {
    const ok = await confirm({
      title: 'Cancel this job?',
      description: 'The job will be marked as cancelled and removed from the queue.',
      confirmLabel: 'Cancel job',
      destructive: true,
    });
    if (!ok) return;

    try {
      await apiFetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      toast({ variant: 'success', title: 'Job cancelled' });
      load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to cancel job';
      toast({ variant: 'destructive', title: 'Failed to cancel job', description: message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Jobs</h2>
          <p className="text-muted-foreground mt-1">Background job history</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      </div>

      {loading && jobs.length === 0 ? (
        <LoadingState label="Loading jobs" />
      ) : error && jobs.length === 0 ? (
        <ErrorState title="Couldn't load jobs" message={error} onRetry={load} retrying={loading} />
      ) : jobs.length === 0 ? (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-12 text-center">
          <p className="text-muted-foreground">No jobs yet</p>
        </div>
      ) : (
        <div className="bg-card text-card-foreground border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">Background jobs</caption>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>Type</th>
                  <th scope="col" className={TH}>Node</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}>Created</th>
                  <th scope="col" className={TH}>Duration</th>
                  <th scope="col" className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((job) => {
                  const status = getJobStatus(job.status);
                  const duration = job.completedAt
                    ? `${Math.round((new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()) / 1000)}s`
                    : job.status === 'RUNNING'
                      ? 'in progress'
                      : '-';

                  return (
                    <tr key={job.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-foreground">{job.type}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{job.nodeName}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{duration}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {job.status === 'PENDING' || job.status === 'RUNNING' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancel(job.id)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            Cancel
                          </Button>
                        ) : job.error ? (
                          <span className="text-destructive text-xs" title={job.error}>
                            Error
                          </span>
                        ) : (
                          '-'
                        )}
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
