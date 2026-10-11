"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActivePath, NAV, NOT_READY_REASON, type NavItem } from "@/lib/nav";
import { canDo } from "@/lib/status";
import { Tooltip } from "@/components/ui/tooltip";
import type { ShellData } from "./types";

export function navItemState(item: NavItem, data: ShellData): { disabled: boolean; reason?: string } {
  if (item.platformAdmin && !data.user.isPlatformAdmin) return { disabled: true, reason: "Requires platform administrator" };
  if (!item.ready) return { disabled: true, reason: NOT_READY_REASON };
  if (item.needsOrg !== false && !data.org) return { disabled: true, reason: "Requires an organization" };
  if (item.permission && !canDo(data.permissions, item.permission)) return { disabled: true, reason: `Requires ${item.permission}` };
  return { disabled: false };
}

export function SidebarNav({ data, collapsed, onNavigate }: { data: ShellData; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-3 px-2 py-2">
      {NAV.filter((g) => !g.platformAdmin || data.user.isPlatformAdmin).map((group) => (
        <div key={group.label}>
          {!collapsed ? <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">{group.label}</div> : <div className="mx-2 mb-2 h-px bg-line" aria-hidden />}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const state = navItemState(item, data);
              const active = isActivePath(pathname, item.href);
              const Icon = item.icon;
              const inner = (
                <>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                  {!collapsed && state.disabled ? <Lock className="ms-auto h-3 w-3 shrink-0 text-fg-dim" aria-hidden /> : null}
                  {!collapsed && !state.disabled && item.badge && (data[item.badge] ?? 0) > 0 ? (
                    <span className="ms-auto rounded-full bg-approval/20 px-1.5 text-[10px] font-semibold tabular text-approval" aria-label={`${data[item.badge]} pending`} data-nav-badge={item.href}>
                      {data[item.badge]}
                    </span>
                  ) : null}
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
              const tip = state.disabled ? (collapsed ? `${item.label}: ${state.reason}` : state.reason) : collapsed ? item.label : null;
              return (
                <li key={item.href}>
                  {tip ? (
                    <Tooltip content={tip} side="right">
                      {node}
                    </Tooltip>
                  ) : (
                    node
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
