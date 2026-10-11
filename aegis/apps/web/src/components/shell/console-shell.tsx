"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as RD } from "radix-ui";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { SidebarNav } from "./sidebar-nav";
import { OrgSwitcher } from "./org-switcher";
import { UserMenu } from "./user-menu";
import { NotificationsMenu } from "./notifications-menu";
import { GlobalSearch } from "./global-search";
import type { ShellData } from "./types";

const STORAGE_KEY = "aegis.sidebar.collapsed";

export function ConsoleShell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // storage unavailable
    }
  }, []);
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  function toggle() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      } catch {
        // storage unavailable
      }
      return !c;
    });
  }
  const brand = (
    <Link href={data.org ? "/overview" : "/platform/tenants"} className="flex h-14 items-center gap-2.5 border-b border-line px-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent/15 text-sm font-semibold text-accent">A</span>
      {!collapsed ? (
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-tight text-fg">AEGIS</span>
          <span className="block truncate text-[10px] uppercase tracking-wide text-fg-dim">Governance console</span>
        </span>
      ) : null}
    </Link>
  );
  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-bg text-fg">
        <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col border-e border-line bg-bg-elev transition-[width] duration-150 ease-out lg:flex", collapsed ? "w-14" : "w-[248px]")} aria-label="Sidebar">
          {brand}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SidebarNav data={data} collapsed={collapsed} />
          </div>
          <div className={cn("flex border-t border-line p-2", collapsed ? "justify-center" : "justify-end")}>
            <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} size="sm" onClick={toggle} aria-expanded={!collapsed}>
              {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
            </IconButton>
          </div>
        </aside>

        <RD.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <RD.Portal>
            <RD.Overlay className="fixed inset-0 z-50 bg-black/60 lg:hidden" />
            <RD.Content className="fixed inset-y-0 start-0 z-50 flex w-[280px] flex-col border-e border-line bg-bg-elev shadow-2xl outline-none lg:hidden">
              <RD.Title className="sr-only">Navigation</RD.Title>
              <RD.Description className="sr-only">Main navigation</RD.Description>
              <div className="flex items-center justify-between border-b border-line pe-2">
                <Link href="/overview" className="flex h-14 items-center gap-2.5 px-3">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-sm font-semibold text-accent">A</span>
                  <span className="text-sm font-semibold tracking-tight">AEGIS</span>
                </Link>
                <RD.Close asChild>
                  <IconButton label="Close navigation" size="sm">
                    <X className="h-4 w-4" aria-hidden />
                  </IconButton>
                </RD.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SidebarNav data={data} collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </div>
            </RD.Content>
          </RD.Portal>
        </RD.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur">
            <IconButton label="Open navigation" className="lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="h-4 w-4" aria-hidden />
            </IconButton>
            <OrgSwitcher data={data} />
            <div className="hidden items-center gap-1.5 sm:flex">
              {data.org?.demoMode ? <DemoBadge /> : null}
              {data.user.isPlatformAdmin ? <Badge tone="info">Platform admin</Badge> : null}
            </div>
            <div className="ms-auto flex items-center gap-1.5">
              <GlobalSearch data={data} />
              <NotificationsMenu initialUnread={data.unread} disabled={!data.org} />
              <UserMenu data={data} />
            </div>
          </header>
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
