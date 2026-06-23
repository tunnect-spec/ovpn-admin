import { AppSidebar, MobileNav } from "@/components/app-sidebar";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/crypto";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;

  // Server-side auth guard: a missing or invalid session is sent to /login.
  // This is the authoritative protection for the dashboard — client-side
  // localStorage checks are cosmetic and must not be relied upon.
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    redirect('/login');
  }

  const userEmail = payload.email;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Background solid effect handled by bg-background */}

      <AppSidebar userEmail={userEmail} />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="glass h-16 border-b border-border/50">
          <div className="flex h-full items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <MobileNav userEmail={userEmail} />
              <div className="h-2 w-2 rounded-full bg-emerald-500 pulse-glow" />
              <span className="text-sm text-muted-foreground">System Status: <span className="text-emerald-400 font-medium">Operational</span></span>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-2 w-2 rounded-full bg-emerald-500 pulse-glow" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
