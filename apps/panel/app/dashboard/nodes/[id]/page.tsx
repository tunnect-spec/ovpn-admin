'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { InstallNodeDialog } from './InstallNodeDialog';

interface NodeDetails {
  id: string;
  name: string;
  host: string;
  status: string;
  version: string | null;
  openvpnVersion: string | null;
  metadata?: unknown;
  xorMask: string | null;
  lastHeartbeatAt: string | null;
  installedAt: string | null;
  createdAt: string;
  healthStatus: {
    status: string;
    details: {
      connectedClients?: number;
      cpu?: number;
      memory?: number;
      uptime?: number;
    };
    checkedAt: string;
  } | null;
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-muted-foreground',
  PROVISIONING: 'bg-blue-500',
  HEALTHY: 'bg-emerald-500',
  UNHEALTHY: 'bg-yellow-500',
  ERROR: 'bg-destructive',
};

const statusBgColors: Record<string, string> = {
  PENDING: 'bg-muted/20 text-muted-foreground',
  PROVISIONING: 'bg-blue-500/20 text-blue-500',
  HEALTHY: 'bg-emerald-500/20 text-emerald-500',
  UNHEALTHY: 'bg-yellow-500/20 text-yellow-500',
  ERROR: 'bg-destructive/20 text-destructive',
};

const statusLabels: Record<string, string> = {
  PENDING: 'Pending Agent',
  PROVISIONING: 'Installing',
  HEALTHY: 'Healthy',
  UNHEALTHY: 'Unhealthy',
  ERROR: 'Error',
};

export default function NodeDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = params.id as string;

  const [node, setNode] = useState<NodeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [showMigrateDialog, setShowMigrateDialog] = useState(false);
  const [migrateToken, setMigrateToken] = useState('');
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState('');

  const fetchNode = async () => {
    const admin = localStorage.getItem('admin');
    if (!admin) {
      router.push('/login');
      return;
    }

    try {
      const res = await fetch(`/api/nodes/${nodeId}`);

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('admin');
          router.push('/login');
          return;
        }
        if (res.status === 404) {
          router.push('/dashboard/nodes');
          return;
        }
        throw new Error('Failed to load node');
      }

      const data = await res.json();
      setNode(data.node);
      setLoading(false);
    } catch (err) {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNode();
    // Refresh every 10 seconds
    const interval = setInterval(fetchNode, 10000);
    return () => clearInterval(interval);
  }, [nodeId]);

  useEffect(() => {
    if (node?.status !== 'PROVISIONING') return;

    const fetchProgress = async () => {
      try {
        const res = await fetch(`/api/nodes/${nodeId}/install-progress`);
        if (res.ok) {
          const data = await res.json();
          setInstallProgress(data.progress);
          setInstallMessage(data.message);
          if (data.status !== 'PENDING') {
            fetchNode();
          }
        }
      } catch (err) {}
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 2000);
    return () => clearInterval(interval);
  }, [node?.status, nodeId]);

  const handleInstall = () => {
    setShowInstallDialog(true);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete node "${node?.name}"?`)) return;

    const res = await fetch(`/api/nodes/${nodeId}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      router.push('/dashboard/nodes');
    } else {
      const data = await res.json();
      alert(data.message || 'Failed to delete node');
    }
  };

  const handleMigrate = async () => {
    if (!confirm('This will disconnect the current server and prepare the panel for a new server. Are you sure?')) return;
    try {
      const res = await fetch(`/api/nodes/${nodeId}/migrate-token`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMigrateToken(data.token);
        setShowMigrateDialog(true);
        fetchNode();
      } else {
        alert(data.message || 'Failed to generate migrate token');
      }
    } catch (e) {
      alert('Error generating token');
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  if (!node) {
    return <div className="text-center py-12 text-destructive">Node not found</div>;
  }

  const canInstall = node.status === 'PENDING' || node.status === 'PROVISIONING';
  const canAddClient = node.status === 'HEALTHY';

  return (
    <div className="space-y-6">
      {showInstallDialog && node && (
        <InstallNodeDialog
          nodeId={node.id}
          defaultHost={node.host}
          onClose={() => setShowInstallDialog(false)}
          onSuccess={() => {
            setShowInstallDialog(false);
            fetchNode();
          }}
        />
      )}

      {showMigrateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card text-card-foreground p-6 rounded-lg shadow-lg max-w-xl w-full border border-border">
            <h3 className="text-xl font-bold mb-4">Migrate Server</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Run the following command on your <strong>new</strong> empty Ubuntu server. This will install the agent, link it to this Node, and restore all PKI keys so existing clients continue to work.
            </p>
            <div className="bg-black/50 p-3 rounded-md mb-6 relative group overflow-hidden">
              <code className="text-xs text-green-400 break-all select-all block">
                curl -fsSL {window.location.origin}/api/agent/install.sh | AGENT_TOKEN={migrateToken} PANEL_URL={window.location.origin} bash
              </code>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => setShowMigrateDialog(false)}
                className="px-4 py-2 border border-border rounded-md hover:bg-secondary/50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{node.name}</h2>
            <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
              statusBgColors[node.status] || statusBgColors.PENDING
            }`}>
              <span className={`w-2 h-2 rounded-full ${statusColors[node.status]}`} />
              {statusLabels[node.status] || node.status}
            </span>
          </div>
          <p className="text-muted-foreground mt-1">{node.host}</p>
        </div>
        <div className="flex gap-2">
          {canInstall && (
            <button
              onClick={handleInstall}
              disabled={installing}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-medium"
            >
              {installing ? 'Installing...' : 'Install OpenVPN'}
            </button>
          )}
          {canAddClient && (
            <Link
              href={`/dashboard/nodes/${nodeId}/clients/new`}
              className="px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600 rounded-md font-medium"
            >
              + Add Client
            </Link>
          )}
        </div>
      </div>

      {node.status === 'PROVISIONING' && (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-6">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-lg">Installing OpenVPN</h3>
            <span className="text-sm font-medium">{installProgress}%</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{installMessage || 'Please wait...'}</p>
          <div className="w-full bg-secondary rounded-full h-3 overflow-hidden">
            <div 
              className="bg-primary h-3 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${installProgress}%` }}
            ></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <DetailCard label="Host / IP" value={node.host} />
        <DetailCard label="Agent Version" value={node.version || '-'} />
        <DetailCard label="OpenVPN" value={node.openvpnVersion || '-'} />
        <DetailCard 
          label="System" 
          value={node.metadata ? `${(node.metadata as any).os || 'Unknown OS'} (${(node.metadata as any).arch || 'Unknown Arch'})` : '-'} 
        />
        <DetailCard
          label="Last Heartbeat"
          value={node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt).toLocaleString() : 'Never'}
        />
        <DetailCard
          label="Created"
          value={new Date(node.createdAt).toLocaleString()}
        />
      </div>

      {node.healthStatus && node.status === 'HEALTHY' && (
        <div className="bg-card text-card-foreground border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Health Status</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Connected Clients"
              value={node.healthStatus.details.connectedClients ?? 0}
            />
            <MetricCard
              label="CPU"
              value={node.healthStatus.details.cpu ? `${node.healthStatus.details.cpu.toFixed(1)}%` : '-'}
            />
            <MetricCard
              label="Memory"
              value={node.healthStatus.details.memory ? `${node.healthStatus.details.memory.toFixed(1)}%` : '-'}
            />
            <MetricCard
              label="Uptime"
              value={node.healthStatus.details.uptime ? `${Math.floor(node.healthStatus.details.uptime / 3600)}h` : '-'}
            />
          </div>
          {node.xorMask && (
            <div className="mt-4 pt-4 border-t border-border">
              <span className="text-sm text-muted-foreground">XOR Mask:</span>
              <code className="ml-2 text-xs">{node.xorMask}</code>
            </div>
          )}
        </div>
      )}

      <div className="bg-card text-card-foreground border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Actions</h3>
        <div className="flex flex-wrap gap-4">
          <Link
            href={`/dashboard/nodes/${nodeId}/clients`}
            className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border rounded-md"
          >
            View Clients
          </Link>
          <Link
            href={`/dashboard/jobs?nodeId=${nodeId}`}
            className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border rounded-md"
          >
            View Jobs
          </Link>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md font-medium"
          >
            Delete Node
          </button>
          <button
            onClick={handleMigrate}
            className="px-4 py-2 bg-yellow-600 text-white hover:bg-yellow-700 rounded-md font-medium ml-auto"
            title="Move this Node and its clients to a new physical server"
          >
            Migrate Server
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted text-muted-foreground border border-border rounded-lg p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
