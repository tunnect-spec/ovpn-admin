'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Lock, Mail, AlertCircle } from 'lucide-react';

import { apiFetch, ApiError } from '@/components/use-api';
import { Spinner } from '@/components/ui/spinner';
import { Logo } from '@/components/ui/logo';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      // The session cookie is set server-side. Use a hard navigation so the
      // server re-renders /dashboard with the new cookie (a client router.push
      // can race the cookie / be a no-op on a cookie-gated server route).
      window.location.assign('/dashboard');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Network error. Please try again.';
      setError(message);
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden">
      {/* Background solid effect handled by bg-background */}

      <Card className="w-full max-w-md glass premium-glow mx-4 animate-in">
        <CardHeader className="text-center space-y-3 pb-6">
          <div className="flex justify-center">
            <Logo size={78} />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">
            <span className="gradient-text">OVPN</span> <span className="text-foreground">Admin</span>
          </CardTitle>
          <CardDescription className="text-base">
            Enter your credentials to access the control panel
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div
              role="alert"
              className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <div className="relative">
                <Mail aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10 h-11"
                  placeholder="admin@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-10 h-11"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-base relative"
              size="lg"
            >
              <span className="relative flex items-center gap-2">
                {loading ? (
                  <>
                    <Spinner className="h-4 w-4" label="Logging in" />
                    Logging in…
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Sign in
                  </>
                )}
              </span>
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
