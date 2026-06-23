'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Server, Trash2, Eye, Clock, Activity, Shield } from 'lucide-react';

import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { getNodeStatus } from '@/components/status-config';
import { LoadingState } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { toast } from '@/components/ui/use-toast';
import { confirm } from '@/components/ui/confirm-dialog';

interface Node {
  id: string;
  name: string;
  host: string;
  status: 'PENDING' | 'PROVISIONING' | 'HEALTHY' | 'UNHEALTHY' | 'ERROR';
  version: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  openvpnVersion?: string | null;
}

export default function NodesPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchNodes = useCallback(async () => {
    setError(false);
    try {
      const data = await apiFetch<{ nodes?: Node[] }>('/api/nodes');
      setNodes(data.nodes || []);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      setError(true);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load nodes',
      });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  const handleDelete = async (nodeId: string, nodeName: string) => {
    const ok = await confirm({
      title: `Delete node "${nodeName}"?`,
      description: 'This removes the node and its configuration from the panel. This cannot be undone.',
      confirmLabel: 'Delete node',
      destructive: true,
    });
    if (!ok) return;

    try {
      await apiFetch(`/api/nodes/${nodeId}`, { method: 'DELETE' });
      toast({ variant: 'success', title: 'Node deleted', description: `"${nodeName}" was removed.` });
      fetchNodes();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Failed to delete node',
        description: err instanceof Error ? err.message : 'Network error while deleting node',
      });
    }
  };

  if (loading) {
    return <LoadingState label="Loading nodes" />;
  }

  if (error && nodes.length === 0) {
    return (
      <ErrorState
        message="We could not load your nodes."
        onRetry={fetchNodes}
        retrying={loading}
      />
    );
  }

  const stats = {
    total: nodes.length,
    healthy: nodes.filter(n => n.status === 'HEALTHY').length,
    unhealthy: nodes.filter(n => n.status === 'UNHEALTHY' || n.status === 'ERROR').length,
    pending: nodes.filter(n => n.status === 'PENDING' || n.status === 'PROVISIONING').length,
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Nodes</h1>
          <p className="text-muted-foreground mt-1">Manage your VPN infrastructure</p>
        </div>
        <Button asChild size="lg" className="gap-2">
          <Link href="/dashboard/nodes/new">
            <Plus className="h-5 w-5" />
            Add Node
          </Link>
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Total Nodes</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-400">{stats.healthy}</div>
                <div className="text-xs text-muted-foreground">Healthy</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Activity className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-400">{stats.unhealthy}</div>
                <div className="text-xs text-muted-foreground">Unhealthy</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-400">{stats.pending}</div>
                <div className="text-xs text-muted-foreground">Pending</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Nodes Grid */}
      {nodes.length === 0 ? (
        <Card className="bg-card">
          <CardContent className="p-12 text-center">
            <div className="h-20 w-20 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-6">
              <Server className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No nodes yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Get started by adding your first VPN node to the infrastructure.
            </p>
            <Button asChild>
              <Link href="/dashboard/nodes/new">
                <Plus className="h-4 w-4" />
                Add Your First Node
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {nodes.map((node) => {
            const status = getNodeStatus(node.status);
            const StatusIcon = status.icon;

            return (
              <Card key={node.id} className="bg-card overflow-hidden hover:border-primary/50 transition-colors group">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
                      <Server className="h-6 w-6 text-primary" />
                    </div>
                    <Badge variant={status.variant} className="gap-1.5">
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </Badge>
                  </div>

                  <div className="space-y-1 mb-4">
                    <h3 className="font-semibold text-lg truncate">{node.name}</h3>
                    <p className="text-sm text-muted-foreground truncate">{node.host}</p>
                  </div>

                  <div className="space-y-2 mb-6">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-medium">{node.openvpnVersion || node.version || 'N/A'}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last Seen</span>
                      <span className="font-medium">
                        {node.lastHeartbeatAt
                          ? new Date(node.lastHeartbeatAt).toLocaleDateString()
                          : 'Never'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-4 border-t border-border/50">
                    <Button asChild variant="outline" size="sm" className="flex-1 gap-2">
                      <Link href={`/dashboard/nodes/${node.id}`}>
                        <Eye className="h-4 w-4" />
                        View
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete node ${node.name}`}
                      onClick={() => handleDelete(node.id, node.name)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
