"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Server,
  Users,
  Briefcase,
  FileText,
  UserCog,
  LogOut,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Logo } from "@/components/ui/logo";

type Role = "SUPERADMIN" | "ADMIN" | "MANAGER";

const baseNav = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Nodes", href: "/dashboard/nodes", icon: Server },
  { name: "Clients", href: "/dashboard/clients", icon: Users },
  { name: "Jobs", href: "/dashboard/jobs", icon: Briefcase },
  { name: "Audit Logs", href: "/dashboard/audit", icon: FileText },
];
// Full admins only.
const adminNav = [{ name: "Managers", href: "/dashboard/managers", icon: UserCog }];

function navFor(role?: Role) {
  return role && role !== "MANAGER" ? [...baseNav, ...adminNav] : baseNav;
}

function SidebarInner({
  userEmail,
  role,
  onNavigate,
}: {
  userEmail?: string;
  role?: Role;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const navigation = navFor(role);
  const roleLabel = role === "MANAGER" ? "Manager" : "Administrator";

  return (
    <div className="flex h-full w-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b border-border/50">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onNavigate}>
          <Logo size={34} />
          <span className="text-lg font-semibold tracking-tight">
            <span className="gradient-text">OVPN</span> <span className="text-foreground">Admin</span>
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Primary">
        {navigation.map((item) => {
          const isActive =
            item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" aria-hidden="true" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-border/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground uppercase">
            {userEmail ? userEmail[0] : "A"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{roleLabel}</p>
            <p className="text-xs text-muted-foreground truncate">{userEmail || "admin@example.com"}</p>
          </div>
        </div>
        <Link
          href="/logout"
          onClick={onNavigate}
          className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-destructive"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Logout
        </Link>
      </div>
    </div>
  );
}

/** Desktop sidebar — hidden below the md breakpoint. */
export function AppSidebar({ userEmail, role }: { userEmail?: string; role?: Role }) {
  return (
    <aside className="hidden md:flex h-full w-64 flex-col glass border-r border-border/50">
      <SidebarInner userEmail={userEmail} role={role} />
    </aside>
  );
}

/** Mobile hamburger + slide-in nav drawer (focus-trapped via Radix Dialog). */
export function MobileNav({ userEmail, role }: { userEmail?: string; role?: Role }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open navigation menu"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="left-0 top-0 h-full w-64 max-w-[80vw] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 border-r p-0 glass sm:rounded-none">
          <DialogTitle className="sr-only">Navigation menu</DialogTitle>
          <SidebarInner userEmail={userEmail} role={role} onNavigate={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
