"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCheck, ChevronRight } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/server/notify/actions";

export type NotificationItem = { id: string; title: string; body: string; href: string | null; urgent: boolean; read: boolean; when: string };

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={disabled || pending} onClick={() => start(async () => { await markAllNotificationsReadAction(); router.refresh(); })} data-testid="mark-all-read">
      <CheckCheck className="size-4" />
      {t("markAllRead")}
    </Button>
  );
}

export function NotificationList({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {items.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            className={cn("flex w-full items-start gap-3 px-4 py-3.5 text-start transition hover:bg-muted/50 sm:px-5", !n.read && "bg-brand-soft/40")}
            onClick={() =>
              start(async () => {
                if (!n.read) await markNotificationReadAction(n.id);
                if (n.href) router.push(n.href);
                else router.refresh();
              })
            }
            data-testid="notification-row"
          >
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.urgent ? "bg-danger" : n.read ? "bg-border" : "bg-brand")} />
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm leading-snug", !n.read && "font-semibold")}>{n.title}</span>
              {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{n.body}</span>}
              <span className="mt-1 block text-xs text-muted-foreground">{n.when}</span>
            </span>
            {n.href && <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
