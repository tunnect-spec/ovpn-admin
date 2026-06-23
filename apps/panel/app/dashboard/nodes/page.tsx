'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Server, Trash2, Eye, Clock, Activity, Shield } from 'lucide-react';

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

const statusConfig: Record<Node['status'], { variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary'; label: string; icon: typeof Activity }> = {
  PENDING: { variant: 'secondary', label: 'Pending', icon: Clock },
  PROVISIONING: { variant: 'default', label: 'Installing', icon: Activity },
  HEALTHY: { variant: 'success', label: 'Healthy', icon: Shield },
  UNHEALTHY: { variant: 'warning', label: 'Unhealthy', icon: Activity },
  ERROR: { variant: 'destructive', label: 'Error', icon: Activity },
};

export default function NodesPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNodes = async () => {
    const admin = localStorage.getItem('admin');
    if (!admin) {
      router.push('/login');
      return;
    }

    try {
      const res = await fetch('/api/nodes');

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('admin');
          router.push('/login');
          return;
        }
        throw new Error('Failed to fetch nodes');
      }

      const data = await res.json();
      setNodes(data.nodes || []);
      setLoading(false);
    } catch (err) {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
  }, []);

  const handleDelete = async (nodeId: string, nodeName: string) => {
    if (!confirm(`Delete node "${nodeName}"?`)) return;

    try {
      const res = await fetch(`/api/nodes/${nodeId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setNodes(nodes.filter(n => n.id !== nodeId));
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to delete node');
      }
    } catch (err) {
      console.error(err);
      alert('Network error while deleting node');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading-spinner" />
      </div>
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
        <Link href="/dashboard/nodes/new">
          <Button size="lg" className="gap-2 group relative overflow-hidden bg-primary hover:bg-primary/90 text-primary-foreground">
            <span className="relative flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add Node
            </span>
          </Button>
        </Link>
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
            <h3 className="text-lg font-semibold mb-2">No nodes configured</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Get started by adding your first VPN node to the infrastructure.
            </p>
            <Link href="/dashboard/nodes/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Node
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {nodes.map((node) => {
            const config = statusConfig[node.status];
            const StatusIcon = config.icon;

            return (
              <Card key={node.id} className="bg-card overflow-hidden hover:border-primary/50 transition-colors group">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
                      <Server className="h-6 w-6 text-primary" />
                    </div>
                    <Badge variant={config.variant} className="gap-1.5">
                      <StatusIcon className="h-3 w-3" />
                      {config.label}
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
                    <Link href={`/dashboard/nodes/${node.id}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full gap-2">
                        <Eye className="h-4 w-4" />
                        View
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
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
