'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Spinner } from '@/components/ui/spinner';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // The dashboard layout enforces auth server-side; unauthenticated users are
    // redirected to /login from there. Here we just forward to the dashboard.
    router.push('/dashboard');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <Spinner className="h-8 w-8 text-primary" label="Loading" />
        <p className="text-muted-foreground">Loading…</p>
      </div>
    </main>
  );
}
