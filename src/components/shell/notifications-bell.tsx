"use client";

import { useState, useTransition } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Bell, CheckCheck } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { markAllNotificationsReadAction, markNotificationReadAction, recentNotificationsAction } from "@/server/notify/actions";

type Item = Awaited<ReturnType<typeof recentNotificationsAction>>[number];

export function NotificationsBell({ unread }: { unread: number }) {
  const t = useTranslations("notifications");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [count, setCount] = useState(unread);
  const [, startTransition] = useTransition();

  const load = (open: boolean) => {
    if (open) startTransition(async () => setItems(await recentNotificationsAction()));
  };

  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("title")} data-testid="notifications-bell">
          <Bell className="size-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -end-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white tabular-nums">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">{t("title")}</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() =>
              startTransition(async () => {
                await markAllNotificationsReadAction();
                setCount(0);
                setItems((prev) => prev?.map((i) => ({ ...i, read: true })) ?? null);
              })
            }
          >
            <CheckCheck className="size-3.5" />
            {t("markAllRead")}
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items === null ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-10" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t("empty")}</div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    className={cn("flex w-full gap-3 px-4 py-3 text-start transition hover:bg-muted/60", !n.read && "bg-brand-soft/50")}
                    onClick={() =>
                      startTransition(async () => {
                        if (!n.read) {
                          await markNotificationReadAction(n.id);
                          setCount((c) => Math.max(0, c - 1));
                        }
                        if (n.href) router.push(n.href);
                      })
                    }
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.urgent ? "bg-danger" : n.read ? "bg-transparent" : "bg-brand")} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{n.title}</span>
                      {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-muted-foreground">{format.relativeTime(new Date(n.createdAt), now)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/notifications">{t("viewAll")}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
