'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { apiFetch, ApiError, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { TERMINAL_JOB_STATUSES } from '@/components/status-config';

const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
  { value: 'never', label: 'Never' },
] as const;

export default function NewClientPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = typeof params.id === 'string' ? params.id : '';

  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState('365');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiFetch<{ job: { id: string; status: string } }>(`/api/nodes/${nodeId}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          expiresIn: expiresIn === 'never' ? undefined : parseInt(expiresIn, 10),
        }),
      });
      setJobId(data.job.id);
      setJobStatus(data.job.status || 'PENDING');
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Network error. Please try again.';
      setError(message);
      toast({ variant: 'destructive', title: 'Failed to create client', description: message });
      setLoading(false);
    }
  };

  // Poll job status with a self-scheduling timeout (never overlaps) + abort on unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!jobId) return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const data = await apiFetch<{ job: { status: string; error: string | null } }>(`/api/jobs/${jobId}`, {
          signal: controller.signal,
        });
        if (!mountedRef.current) return;

        setJobStatus(data.job.status);

        if (data.job.status === 'COMPLETED') {
          toast({ variant: 'success', title: 'Client created' });
          router.push(`/dashboard/nodes/${nodeId}/clients`);
          return;
        }
        if (TERMINAL_JOB_STATUSES.has(data.job.status)) {
          setLoading(false);
          const message = data.job.error || 'Client creation did not complete.';
          setError(message);
          toast({ variant: 'destructive', title: 'Client creation failed', description: message });
          return;
        }
        // Not terminal yet — schedule the next poll only now.
        timer = setTimeout(poll, 2000);
      } catch (err) {
        if (controller.signal.aborted || !mountedRef.current) return;
        if (err instanceof UnauthorizedError) {
          router.push('/login');
          return;
        }
        // Transient error — keep polling but surface it once.
        const message = err instanceof ApiError ? err.message : 'Lost connection while tracking the job.';
        setError(message);
        timer = setTimeout(poll, 3000);
      }
    };

    poll();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, nodeId, router]);

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Add New Client</h2>
        <p className="text-muted-foreground mt-1">Create a VPN client configuration</p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {jobId ? (
        <Card className="max-w-2xl">
          <CardContent className="py-16 text-center">
            <Spinner className="mx-auto mb-4 h-8 w-8 text-primary" label="Creating client" />
            <p className="text-muted-foreground mb-2">Creating client configuration…</p>
            <p className="text-sm text-muted-foreground">Status: {jobStatus || 'PENDING'}</p>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="bg-card text-card-foreground border border-border rounded-lg p-6 space-y-5 max-w-2xl">
          <div className="space-y-2">
            <Label htmlFor="client-name">Client Name</Label>
            <Input
              id="client-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              pattern="^[a-zA-Z0-9._-]+$"
              placeholder="e.g., user1, laptop, iphone-john"
            />
            <p className="text-xs text-muted-foreground">Letters, numbers, dots, underscores, hyphens only</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-expires">Expires In</Label>
            <select
              id="client-expires"
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              className="w-full px-4 py-2 h-10 bg-background text-foreground border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="bg-muted text-muted-foreground border border-border rounded p-4 text-sm">
            <p>After creation, the .ovpn file will be available for download.</p>
            <p className="mt-1">The client app must support OpenVPN XOR / scramble xormask.</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-2">
              {loading ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Creating…
                </>
              ) : (
                'Create Client'
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
