'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function NewClientPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = params.id as string;

  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState('365');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [jobStatus, setJobStatus] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`/api/nodes/${nodeId}/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          expiresIn: expiresIn === 'never' ? undefined : parseInt(expiresIn),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Failed to create client');
        setLoading(false);
        return;
      }

      setJobId(data.job.id);
      setJobStatus('pending');
      setPolling(true);
      setLoading(false);
    } catch (err) {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  };

  // Poll job status
  useEffect(() => {
    if (!polling || !jobId) return;

    const interval = setInterval(async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      const data = await response.json();

      setJobStatus(data.job.status);

      if (data.job.status === 'COMPLETED') {
        setPolling(false);
        router.push(`/dashboard/nodes/${nodeId}/clients`);
      } else if (data.job.status === 'FAILED') {
        setPolling(false);
        setError(data.job.error || 'Failed to create client');
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [polling, jobId, nodeId, router]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Add New Client</h2>
        <p className="text-gray-400 mt-1">Create a VPN client configuration</p>
      </div>

      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-lg text-error">
          {error}
        </div>
      )}

      {polling ? (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400 mb-2">Creating client configuration...</p>
          <p className="text-sm text-gray-500">Status: {jobStatus}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-card text-card-foreground border border-border rounded-lg p-6 space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2">
              Client Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              pattern="^[a-zA-Z0-9._-]+$"
              className="w-full px-4 py-2 bg-background text-foreground border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-input"
              placeholder="e.g., user1, laptop, iphone-john"
            />
            <p className="text-xs text-gray-400 mt-1">Letters, numbers, dots, underscores, hyphens only</p>
          </div>

          <div>
            <label htmlFor="expires" className="block text-sm font-medium mb-2">
              Expires In
            </label>
            <select
              id="expires"
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              className="w-full px-4 py-2 bg-background text-foreground border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-input"
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="730">2 years</option>
              <option value="never">Never</option>
            </select>
          </div>

          <div className="bg-muted text-muted-foreground border border-border rounded p-4 text-sm">
            <p>After creation, the .ovpn file will be available for download.</p>
            <p className="mt-1">The client app must support OpenVPN XOR / scramble xormask.</p>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-medium"
            >
              {loading ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
