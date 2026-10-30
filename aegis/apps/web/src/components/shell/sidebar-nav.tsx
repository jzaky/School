"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { GETTING_STARTED, isActivePath, isSecondaryPath, NOT_READY_REASON, PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "@/lib/nav";
import { canDo } from "@/lib/status";
import { Tooltip } from "@/components/ui/tooltip";
import type { ShellData } from "./types";
import { useT } from "@/components/region-provider";

const MORE_KEY = "aegis.sidebar.more";

export function navItemState(item: NavItem, data: ShellData): { disabled: boolean; reason?: string } {
  if (item.platformAdmin && !data.user.isPlatformAdmin) return { disabled: true, reason: "Requires platform administrator" };
  if (!item.ready) return { disabled: true, reason: NOT_READY_REASON };
  if (item.needsOrg !== false && !data.org) return { disabled: true, reason: "Requires an organization" };
  if (item.permission && !canDo(data.permissions, item.permission)) return { disabled: true, reason: `Requires ${item.permission}` };
  return { disabled: false };
}

/** The Getting started link shows while steps remain and nobody dismissed the checklist. */
export function showGettingStarted(data: ShellData): boolean {
  const o = data.onboarding;
  return !!o && !o.dismissed && o.done < o.total;
}

function NavEntry({ item, data, collapsed, onNavigate, progress }: { item: NavItem; data: ShellData; collapsed: boolean; onNavigate?: () => void; progress?: string }) {
  const pathname = usePathname();
  const { nav } = useT();
  const label = nav(item.label);
  const state = navItemState(item, data);
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  const badge = item.badge ? (data[item.badge] ?? 0) : 0;
  const inner = (
    <>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!collapsed ? <span className="truncate">{label}</span> : null}
      {!collapsed && state.disabled ? <Lock className="ms-auto h-3 w-3 shrink-0 text-fg-dim" aria-hidden /> : null}
      {!collapsed && !state.disabled && badge > 0 ? (
        <span className="ms-auto rounded-full bg-approval/20 px-1.5 text-[10px] font-semibold tabular text-approval" aria-label={`${badge} pending`} data-nav-badge={item.href}>
          {badge}
        </span>
      ) : null}
      {!collapsed && !state.disabled && progress ? <span className="ms-auto rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold tabular text-accent">{progress}</span> : null}
    </>
  );
  const cls = cn("flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-150", collapsed && "justify-center px-0", active ? "bg-accent/15 text-fg" : "text-fg-muted hover:bg-bg-elev-2 hover:text-fg", state.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-fg-muted");
  const node = state.disabled ? (
    <span role="link" aria-disabled="true" tabIndex={0} className={cls} data-nav-item={item.href} data-disabled="true">
      {inner}
    </span>
  ) : (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={cls} onClick={onNavigate} data-nav-item={item.href}>
      {inner}
    </Link>
  );
  const tip = state.disabled ? (collapsed ? `${label}: ${state.reason}` : state.reason) : collapsed ? label : null;
  return (
    <li>
      {tip ? (
        <Tooltip content={tip} side="right">
          {node}
        </Tooltip>
      ) : (
        node
      )}
    </li>
  );
}

export function SidebarNav({ data, collapsed, onNavigate }: { data: ShellData; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t, nav } = useT();
  const onSecondary = isSecondaryPath(pathname);
  // Collapsed by default; the preference persists per browser. Opens on its own while a secondary page is active.
  const [moreOpen, setMoreOpen] = React.useState(false);
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MORE_KEY);
      if (stored === "1") setMoreOpen(true);
    } catch {
      // storage unavailable
    }
  }, []);
  function toggleMore() {
    setMoreOpen((o) => {
      try {
        window.localStorage.setItem(MORE_KEY, o ? "0" : "1");
      } catch {
        // storage unavailable
      }
      return !o;
    });
  }
  const expanded = moreOpen || onSecondary;
  const groups = SECONDARY_NAV.filter((g) => !g.platformAdmin || data.user.isPlatformAdmin);
  const gettingStarted = showGettingStarted(data);
  return (
    <nav aria-label="Main" className="flex flex-col gap-3 px-2 py-2">
      <ul className="space-y-0.5">
        {gettingStarted ? <NavEntry item={GETTING_STARTED} data={data} collapsed={collapsed} onNavigate={onNavigate} progress={data.onboarding ? `${data.onboarding.done}/${data.onboarding.total}` : undefined} /> : null}
        {PRIMARY_NAV.map((item) => (
          <NavEntry key={item.href} item={item} data={data} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </ul>
      <div>
        {collapsed ? <div className="mx-2 mb-2 h-px bg-line" aria-hidden /> : null}
        <button
          type="button"
          onClick={toggleMore}
          aria-expanded={expanded}
          aria-controls="sidebar-more"
          data-nav-more
          title={collapsed ? (expanded ? "Hide specialist sections" : "Show specialist sections") : undefined}
          className={cn("flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-fg-muted transition-colors duration-150 hover:bg-bg-elev-2 hover:text-fg", collapsed && "justify-center px-0")}
        >
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-150", expanded ? "rotate-0" : "-rotate-90 rtl:rotate-90")} aria-hidden />
          {!collapsed ? <span className="truncate">{t("shell.more")}</span> : <span className="sr-only">{t("shell.more")}</span>}
        </button>
        {expanded ? (
          <div id="sidebar-more" className="mt-2 flex flex-col gap-3">
            {groups.map((group) => (
              <div key={group.label}>
                {!collapsed ? <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">{nav(group.label)}</div> : <div className="mx-2 mb-2 h-px bg-line" aria-hidden />}
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavEntry key={item.href} item={item} data={data} collapsed={collapsed} onNavigate={onNavigate} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
