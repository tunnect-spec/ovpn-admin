'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { apiFetch } from '@/components/use-api';
import { Spinner } from '@/components/ui/spinner';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const logout = async () => {
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // Even if the request fails, the cookie may already be gone — always
        // send the user back to the login screen.
      } finally {
        if (!cancelled) router.push('/login');
      }
    };
    logout();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <Spinner className="h-8 w-8 text-primary" label="Logging out" />
        <p className="text-muted-foreground">Logging out…</p>
      </div>
    </main>
  );
}
