"use client";
import * as React from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { switchOrgAction } from "@/server/actions/auth";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { ShellData } from "./types";

export function OrgSwitcher({ data }: { data: ShellData }) {
  const [pending, startTransition] = React.useTransition();
  if (!data.org) {
    return (
      <div className="inline-flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-sm text-fg-muted">
        <Building2 className="h-4 w-4" aria-hidden />
        No organization
      </div>
    );
  }
  const single = data.memberships.length <= 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={single || pending} aria-label="Switch organization" title={single ? "You belong to one organization" : undefined} className="inline-flex h-8 max-w-[260px] items-center gap-2 rounded-md border border-line bg-bg-elev px-2.5 text-sm text-fg transition-colors duration-150 hover:bg-bg-elev-2 disabled:cursor-default disabled:hover:bg-bg-elev">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-accent/15 text-[11px] font-semibold text-accent">{data.org.name.slice(0, 1).toUpperCase()}</span>
          <span className="truncate font-medium">{data.org.name}</span>
          {!single ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-dim" aria-hidden /> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {data.memberships.map((m) => (
          <DropdownMenuItem key={m.orgId} onSelect={() => startTransition(() => switchOrgAction(m.orgId))} className="justify-between">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{m.orgName}</span>
              {m.orgDemo ? <Badge tone="approval">Demo</Badge> : null}
            </span>
            <span className="flex items-center gap-2 text-xs text-fg-dim">
              {m.roleName}
              {m.orgId === data.org?.id ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden /> : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
