import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { ConfirmDialogHost } from '@/components/ui/confirm-dialog';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'OpenVPN Admin Panel',
  description: 'Self-hosted admin panel for OpenVPN XOR nodes',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster />
        <ConfirmDialogHost />
      </body>
    </html>
  );
}
