'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Terminal, Shield, ArrowLeft, Plus } from 'lucide-react';
import { apiFetch, UnauthorizedError } from '@/components/use-api';
import { toast } from '@/components/ui/use-toast';
import { Spinner } from '@/components/ui/spinner';

export default function NewNodePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ registrationToken: string; installCommand: string; node: { id: string; name: string } } | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiFetch<{ registrationToken: string; installCommand: string; node: { id: string; name: string } }>(
        '/api/nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, host, port: parseInt(port, 10) }),
        },
      );
      setResult(data);
      toast({ variant: 'success', title: 'Node created', description: `"${data.node.name}" is ready for agent installation.` });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push('/login');
        return;
      }
      const message = err instanceof Error ? err.message : 'Network error. Please try again.';
      setError(message);
      toast({ variant: 'destructive', title: 'Failed to create node', description: message });
    } finally {
      setLoading(false);
    }
  };

  const copyToken = async () => {
    await navigator.clipboard.writeText(result!.registrationToken);
    setCopiedToken(true);
    toast({ variant: 'success', title: 'Registration token copied' });
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const copyCommand = async () => {
    await navigator.clipboard.writeText(result!.installCommand);
    setCopiedCommand(true);
    toast({ variant: 'success', title: 'Install command copied' });
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  if (result) {
    return (
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" aria-label="Back to nodes" onClick={() => router.push('/dashboard/nodes')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Node Created Successfully</h1>
            <p className="text-muted-foreground mt-1">Install the agent on your VPN server</p>
          </div>
        </div>

        {/* Success Banner */}
        <Card className="glass bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="py-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-emerald-500 flex items-center justify-center">
                <Check className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">Node "{result.node.name}" Ready</h3>
                <p className="text-sm text-muted-foreground">Follow the installation steps below</p>
              </div>
              <Badge variant="success" className="gap-1">
                <Shield className="h-3 w-3" />
                Secure
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Registration Token */}
        <Card className="glass">
          <CardHeader>
            <CardTitle>Registration Token</CardTitle>
            <CardDescription>
              Save this token now - it won't be shown again
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 p-4 bg-muted/50 rounded-lg border border-border/50 font-mono text-sm break-all">
                {result.registrationToken}
              </div>
              <Button
                onClick={copyToken}
                variant={copiedToken ? 'default' : 'outline'}
                className="shrink-0"
              >
                {copiedToken ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Install Command */}
        <Card className="glass">
          <CardHeader>
            <CardTitle>Install Command</CardTitle>
            <CardDescription>
              Run this command on your VPN server as root
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <div className="absolute top-3 left-3">
                <Terminal className="h-4 w-4 text-muted-foreground" />
              </div>
              <pre className="pl-10 pr-16 py-3 bg-muted/50 rounded-lg border border-border/50 text-xs overflow-x-auto">
                {result.installCommand}
              </pre>
              <Button
                onClick={copyCommand}
                variant="ghost"
                size="sm"
                aria-label="Copy install command"
                className="absolute top-2 right-2"
              >
                {copiedCommand ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Installation Steps */}
        <Card className="glass">
          <CardHeader>
            <CardTitle>Installation Steps</CardTitle>
            <CardDescription>Follow these steps to complete the setup</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {[
                { title: 'SSH into server', desc: 'Connect to your VPN server as root user' },
                { title: 'Open firewall port', desc: 'Ensure UDP port 443 is open in your firewall' },
                { title: 'Run install command', desc: 'Paste and execute the command above on your server' },
                { title: 'Wait for registration', desc: 'Agent will connect and status changes to "Installing"' },
                { title: 'Install OpenVPN', desc: 'Click the install button on the node details page' },
              ].map((step, i) => (
                <li key={i} className="flex gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                    <span className="text-sm font-semibold text-primary">{i + 1}</span>
                  </div>
                  <div className="flex-1 pt-1">
                    <h4 className="font-medium">{step.title}</h4>
                    <p className="text-sm text-muted-foreground">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <Button
            onClick={copyCommand}
            className="gap-2"
          >
            <Terminal className="h-4 w-4" />
            Copy Install Command
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard/nodes')}
          >
            Back to Nodes
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Go back" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Add New Node</h1>
          <p className="text-muted-foreground mt-1">Register a VPN node with the panel</p>
        </div>
      </div>

      {error && (
        <Card className="glass bg-destructive/10 border-destructive/20">
          <CardContent className="py-4">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card className="glass">
        <CardHeader>
          <CardTitle>Node Configuration</CardTitle>
          <CardDescription>Enter the details for your VPN server</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Node Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                pattern="^[a-zA-Z0-9._-]+$"
                placeholder="e.g., vpn-server-1"
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">
                Letters, numbers, dots, underscores, hyphens only
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="host">Host (IP or Domain)</Label>
              <Input
                id="host"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
                placeholder="e.g., 192.168.1.100 or vpn.example.com"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="port">SSH Port (reference only)</Label>
              <Input
                id="port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                min="1"
                max="65535"
                className="h-11"
              />
            </div>
            </div>

            <div className="flex items-center justify-end gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="gap-2">
                {loading ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Create Node
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
