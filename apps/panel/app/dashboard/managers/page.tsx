'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Pencil, Users, Server } from 'lucide-react';

import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { useSession } from '@/components/session-context';
import { toast } from '@/components/ui/use-toast';
import { confirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner, LoadingState } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface NodeLite {
  id: string;
  name: string;
}
interface Manager {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  lastSeen?: string | null;
  lastLoginAt: string | null;
  nodes: NodeLite[];
}

export default function ManagersPage() {
  const router = useRouter();
  const { isFullAdmin } = useSession();

  const [managers, setManagers] = useState<Manager[]>([]);
  const [nodes, setNodes] = useState<NodeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state: null = closed, {} = create, {id} = edit.
  const [dialog, setDialog] = useState<null | { id?: string; email: string }>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, n] = await Promise.all([
        apiFetch<{ managers: Manager[] }>('/api/admins'),
        apiFetch<{ nodes: NodeLite[] }>('/api/nodes?limit=100'),
      ]);
      setManagers(m.managers || []);
      setNodes(n.nodes || []);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to load managers';
      setError(message);
      toast({ variant: 'destructive', title: 'Failed to load', description: message });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (isFullAdmin) load();
    else setLoading(false);
  }, [isFullAdmin, load]);

  if (!isFullAdmin) {
    return (
      <ErrorState
        title="Administrators only"
        message="Manager accounts can only be created and managed by an administrator."
        onRetry={() => router.push('/dashboard')}
      />
    );
  }

  const openCreate = () => {
    setDialog({ email: '' });
    setEmail('');
    setPassword('');
    setSelected(new Set());
  };
  const openEdit = (m: Manager) => {
    setDialog({ id: m.id, email: m.email });
    setEmail(m.email);
    setPassword('');
    setSelected(new Set(m.nodes.map((n) => n.id)));
  };

  const toggleNode = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
    setSaving(true);
    try {
      const nodeIds = Array.from(selected);
      if (dialog.id) {
        await apiFetch(`/api/admins/${dialog.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeIds, ...(password ? { password } : {}) }),
        });
        toast({ variant: 'success', title: 'Manager updated' });
      } else {
        await apiFetch('/api/admins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, nodeIds }),
        });
        toast({ variant: 'success', title: 'Manager created', description: email });
      }
      setDialog(null);
      load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to save manager';
      toast({ variant: 'destructive', title: 'Save failed', description: message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: Manager) => {
    const ok = await confirm({
      title: `Delete manager "${m.email}"?`,
      description: 'They lose access immediately. Their assigned nodes and the clients on them are not affected.',
      confirmLabel: 'Delete manager',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(m.id);
    try {
      await apiFetch(`/api/admins/${m.id}`, { method: 'DELETE' });
      toast({ variant: 'success', title: 'Manager deleted', description: m.email });
      load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to delete manager';
      toast({ variant: 'destructive', title: 'Delete failed', description: message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Managers</h1>
          <p className="text-muted-foreground mt-1">
            Scoped accounts that manage clients on the nodes you assign them — they can&apos;t create or configure nodes.
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add Manager
        </Button>
      </div>

      {loading ? (
        <LoadingState label="Loading managers" />
      ) : error ? (
        <ErrorState title="Couldn't load managers" message={error} onRetry={load} retrying={loading} />
      ) : managers.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Users className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground mb-4">No managers yet.</p>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Add your first manager
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {managers.map((m) => (
            <div key={m.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{m.email}</span>
                    <Badge variant="secondary">Manager</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Last login: {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : 'never'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => openEdit(m)} disabled={busyId === m.id}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${m.email}`}
                    title="Delete manager"
                    onClick={() => remove(m)}
                    disabled={busyId === m.id}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1">Nodes:</span>
                {m.nodes.length === 0 ? (
                  <span className="text-xs text-muted-foreground/70">none assigned</span>
                ) : (
                  m.nodes.map((n) => (
                    <Badge key={n.id} variant="outline" className="gap-1">
                      <Server className="h-3 w-3" />
                      {n.name}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o && !saving) setDialog(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog?.id ? 'Edit manager' : 'Add manager'}</DialogTitle>
            <DialogDescription>
              {dialog?.id
                ? 'Change which nodes this manager can manage, or reset their password.'
                : 'Create a scoped account and assign the nodes they may manage clients on.'}
            </DialogDescription>
          </DialogHeader>

          <form id="manager-form" onSubmit={save} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="mgr-email">Email</Label>
              <Input
                id="mgr-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={!!dialog?.id}
                placeholder="manager@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mgr-password">{dialog?.id ? 'New password (optional)' : 'Password'}</Label>
              <Input
                id="mgr-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!dialog?.id}
                minLength={8}
                placeholder={dialog?.id ? 'Leave blank to keep current' : 'At least 8 characters'}
              />
            </div>
            <div className="space-y-2">
              <Label>Assigned nodes</Label>
              {nodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No nodes exist yet — create a node first.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {nodes.map((n) => (
                    <label key={n.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={selected.has(n.id)}
                        onChange={() => toggleNode(n.id)}
                      />
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{n.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{selected.size} node(s) selected.</p>
            </div>
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={saving}>
              Cancel
            </Button>
            <Button form="manager-form" type="submit" disabled={saving} className="gap-2">
              {saving ? (<><Spinner className="h-4 w-4" />Saving…</>) : dialog?.id ? 'Save changes' : 'Create manager'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
