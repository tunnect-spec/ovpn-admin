'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Server, Users, Briefcase, ArrowRight, Activity, TrendingUp, Shield } from 'lucide-react';
import Link from 'next/link';

import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { LoadingState } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { toast } from '@/components/ui/use-toast';

interface Stats {
  nodes: { total: number; healthy: number; unhealthy: number; pending: number; error: number };
  clients: { total: number; active: number; revoked: number; expired: number };
  jobs: { running: number; failed: number; pending: number };
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchStats = useCallback(async () => {
    setError(false);
    try {
      const data = await apiFetch<Stats>('/api/dashboard/stats');
      setStats(data);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      setError(true);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load stats',
      });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return <LoadingState label="Loading dashboard" />;
  }

  if (error && !stats) {
    return (
      <ErrorState
        message="We could not load the dashboard stats."
        onRetry={fetchStats}
        retrying={loading}
      />
    );
  }

  if (!stats) {
    return <div className="text-center py-12 text-muted-foreground">No stats available</div>;
  }

  const nodeHealthPercentage = stats.nodes.total > 0
    ? Math.round((stats.nodes.healthy / stats.nodes.total) * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your OpenVPN infrastructure</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success" className="gap-1">
            <div className="h-2 w-2 rounded-full bg-white pulse-glow" />
            System Operational
          </Badge>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Nodes Card */}
        <Card className="bg-card overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Nodes</CardTitle>
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Server className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <div className="text-4xl font-bold">{stats.nodes.total}</div>
              <div className="text-sm text-muted-foreground mb-1">total</div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Health</span>
                <span className="font-medium text-emerald-400">{nodeHealthPercentage}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${nodeHealthPercentage}%` }}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Badge variant="outline" className="text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1" />
                {stats.nodes.healthy} Healthy
              </Badge>
              <Badge variant="outline" className="text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-1" />
                {stats.nodes.pending} Pending
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Clients Card */}
        <Card className="bg-card overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Clients</CardTitle>
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <div className="text-4xl font-bold">{stats.clients.total}</div>
              <div className="text-sm text-muted-foreground mb-1">total</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-2xl font-semibold text-emerald-400">{stats.clients.active}</div>
                <div className="text-xs text-muted-foreground">Active</div>
              </div>
              <div className="space-y-1">
                <div className="text-2xl font-semibold text-destructive">{stats.clients.revoked}</div>
                <div className="text-xs text-muted-foreground">Revoked</div>
              </div>
            </div>
            <div className="mt-4">
              <Button asChild variant="ghost" size="sm" className="w-full justify-between">
                <Link href="/dashboard/nodes">
                  Manage Clients
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Jobs Card */}
        <Card className="bg-card overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Jobs</CardTitle>
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Briefcase className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <div className="text-4xl font-bold">{stats.jobs.running + stats.jobs.pending}</div>
              <div className="text-sm text-muted-foreground mb-1">active</div>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Running</span>
                <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-primary/30">
                  {stats.jobs.running}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pending</span>
                <Badge variant="secondary">{stats.jobs.pending}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Failed</span>
                <Badge variant="destructive" className="bg-destructive/20 text-destructive border-destructive/30 hover:bg-destructive/30">
                  {stats.jobs.failed}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Common tasks and shortcuts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <Button asChild className="w-full h-auto py-4 group relative overflow-hidden" size="lg">
              <Link href="/dashboard/nodes/new">
                <div className="relative flex items-center gap-3">
                  <Plus className="h-5 w-5" />
                  <div className="text-left">
                    <div className="font-medium">Add Node</div>
                    <div className="text-xs text-primary-foreground/70">Register a new VPN node</div>
                  </div>
                </div>
              </Link>
            </Button>

            <Button asChild variant="outline" className="w-full h-auto py-4 group" size="lg">
              <Link href="/dashboard/nodes">
                <div className="flex items-center gap-3">
                  <Server className="h-5 w-5" />
                  <div className="text-left">
                    <div className="font-medium">View Nodes</div>
                    <div className="text-xs text-muted-foreground">Manage all nodes</div>
                  </div>
                </div>
              </Link>
            </Button>

            <Button asChild variant="outline" className="w-full h-auto py-4 group" size="lg">
              <Link href="/dashboard/jobs">
                <div className="flex items-center gap-3">
                  <Activity className="h-5 w-5" />
                  <div className="text-left">
                    <div className="font-medium">View Jobs</div>
                    <div className="text-xs text-muted-foreground">Check job status</div>
                  </div>
                </div>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* System Status Banner */}
      <Card className="bg-card border-emerald-500/20">
        <CardContent className="py-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Shield className="h-6 w-6 text-emerald-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">All Systems Operational</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Your VPN infrastructure is running smoothly. {stats.nodes.healthy} of {stats.nodes.total} nodes are healthy.
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-emerald-400" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
