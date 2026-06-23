import { AppSidebar } from "@/components/app-sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Background solid effect handled by bg-background */}

      <AppSidebar />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="glass h-16 border-b border-border/50">
          <div className="flex h-full items-center justify-between px-6">
            <div className="flex items-center gap-2">
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
