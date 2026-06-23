'use client';

import { useState } from 'react';

import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface InstallNodeDialogProps {
  nodeId: string;
  defaultHost: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function InstallNodeDialog({ nodeId, defaultHost, onClose, onSuccess }: InstallNodeDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [useXor, setUseXor] = useState(true);
  const [domain, setDomain] = useState('');
  const [dnsMode, setDnsMode] = useState<'standard' | 'empty' | 'custom'>('standard');
  const [customDns, setCustomDns] = useState('');
  const [mtu, setMtu] = useState(1500);
  const [mssfix, setMssfix] = useState(1360);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiFetch(`/api/nodes/${nodeId}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverHost: defaultHost,
          useXor,
          domain: domain.trim() || undefined,
          dnsMode,
          customDns: dnsMode === 'custom' ? customDns : undefined,
          mtu,
          mssfix,
        }),
      });
      toast({ variant: 'success', title: 'Installation started', description: 'Track progress on the node page.' });
      onSuccess();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setError('Your session expired. Please sign in again.');
        setLoading(false);
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to start installation';
      setError(message);
      toast({ variant: 'destructive', title: 'Installation failed to start', description: message });
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !loading) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Install OpenVPN</DialogTitle>
          <DialogDescription>Configure your server setup</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/40 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        <form id="install-form" onSubmit={handleSubmit} className="space-y-6">
          {/* Connection Type */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Connection Type</legend>
            <div className="flex gap-4">
              <label className="flex-1 flex items-center gap-3 p-4 border border-border rounded-lg cursor-pointer hover:bg-secondary/50">
                <input type="radio" name="conn-type" checked={useXor} onChange={() => setUseXor(true)} className="w-4 h-4 accent-primary" />
                <div>
                  <div className="font-medium">OpenVPN + XOR</div>
                  <div className="text-xs text-muted-foreground">Obfuscated connection</div>
                </div>
              </label>
              <label className="flex-1 flex items-center gap-3 p-4 border border-border rounded-lg cursor-pointer hover:bg-secondary/50">
                <input type="radio" name="conn-type" checked={!useXor} onChange={() => setUseXor(false)} className="w-4 h-4 accent-primary" />
                <div>
                  <div className="font-medium">Standard</div>
                  <div className="text-xs text-muted-foreground">No obfuscation</div>
                </div>
              </label>
            </div>
          </fieldset>

          {/* Domain */}
          <div className="space-y-2">
            <Label htmlFor="install-domain">Domain / Hostname (optional)</Label>
            <Input
              id="install-domain"
              type="text"
              placeholder="e.g. vpn.example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Leave empty to use server IP ({defaultHost}).</p>
          </div>

          {/* DNS Mode */}
          <div className="space-y-2">
            <Label htmlFor="install-dns">DNS Settings</Label>
            <select
              id="install-dns"
              value={dnsMode}
              onChange={(e) => setDnsMode(e.target.value as 'standard' | 'empty' | 'custom')}
              className="w-full bg-background border border-input rounded-md px-3 py-2 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="standard">Standard (8.8.8.8, 1.1.1.1)</option>
              <option value="empty">Empty (do not push DNS)</option>
              <option value="custom">Custom DNS</option>
            </select>
            {dnsMode === 'custom' && (
              <Input
                type="text"
                placeholder="8.8.8.8, 1.1.1.1"
                value={customDns}
                onChange={(e) => setCustomDns(e.target.value)}
                required
                className="mt-2"
                aria-label="Custom DNS servers"
              />
            )}
          </div>

          {/* MTU / MSSFIX */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="install-mtu">MTU</Label>
              <Input id="install-mtu" type="number" value={mtu} onChange={(e) => setMtu(Number(e.target.value))} required min={500} max={9000} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="install-mssfix">MSSFIX</Label>
              <Input id="install-mssfix" type="number" value={mssfix} onChange={(e) => setMssfix(Number(e.target.value))} required min={500} max={9000} />
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button form="install-form" type="submit" disabled={loading} className="gap-2">
            {loading ? (<><Spinner className="h-4 w-4" />Starting…</>) : 'Start Installation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
