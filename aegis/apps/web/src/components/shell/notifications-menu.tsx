"use client";
import * as React from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { listNotificationsAction, markNotificationsReadAction } from "@/server/actions/notifications";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/ui/time";

interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsMenu({ initialUnread, disabled }: { initialUnread: number; disabled?: boolean }) {
  const [unread, setUnread] = React.useState(initialUnread);
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  async function load() {
    setLoading(true);
    const r = await listNotificationsAction();
    setLoading(false);
    if (r.ok) {
      setItems(r.data.items);
      setUnread(r.data.unread);
    } else toast.error(r.error);
  }

  async function markAll() {
    const r = await markNotificationsReadAction();
    if (!r.ok) return toast.error(r.error);
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    setUnread(0);
  }

  async function markOne(id: string) {
    const r = await markNotificationsReadAction([id]);
    if (!r.ok) return toast.error(r.error);
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) ?? null);
    setUnread((u) => Math.max(0, u - 1));
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !disabled) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled} aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} title={disabled ? "Notifications are available once you belong to an organization" : undefined} className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-bg-elev-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50">
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 ? <span className="absolute end-1 top-1 min-w-[16px] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 tabular text-white">{unread > 99 ? "99+" : unread}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <div className="text-sm font-medium text-fg">Notifications</div>
          <Button variant="ghost" size="sm" onClick={markAll} disabled={unread === 0} disabledReason="Nothing unread">
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
            Mark all read
          </Button>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {loading && !items ? (
            <div className="px-3 py-6 text-center text-xs text-fg-dim">Loading</div>
          ) : !items || items.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-fg-dim">No notifications yet. Approval requests and alerts will appear here.</div>
          ) : (
            <ul>
              {items.map((n) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className={cn("text-sm", n.readAt ? "text-fg-muted" : "font-medium text-fg")}>{n.title}</div>
                      <div className="shrink-0 text-[11px] tabular text-fg-dim"><TimeAgo value={n.createdAt} /></div>
                    </div>
                    {n.body ? <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{n.body}</div> : null}
                  </>
                );
                return (
                  <li key={n.id} className="border-b border-line last:border-b-0">
                    {n.link ? (
                      <Link href={n.link} onClick={() => void markOne(n.id)} className="block px-3 py-2.5 transition-colors duration-150 hover:bg-bg-elev">
                        {body}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => void markOne(n.id)} className="block w-full px-3 py-2.5 text-start transition-colors duration-150 hover:bg-bg-elev">
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
