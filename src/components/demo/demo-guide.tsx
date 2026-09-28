"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Circle, Compass, X } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Step = { key: string; href: string; title: string; body: string };

function read(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Storage can be unavailable (private mode); the guide still works for this visit.
  }
}

/** A floating checklist that suggests what to try as the current demo persona. */
export function DemoGuide({ persona, intro, steps }: { persona: string; intro: string; steps: Step[] }) {
  const t = useTranslations("guide");
  const pathname = usePathname();
  const storeKey = `guide:${persona}`;
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    setDone(read(storeKey));
    // Open automatically the first time someone uses this persona.
    if (!read("guide:seen").includes(persona)) {
      setOpen(true);
      write("guide:seen", [...read("guide:seen"), persona]);
    }
  }, [persona, storeKey]);

  useEffect(() => {
    const hit = steps.find((s) => pathname === s.href.split("?")[0]);
    if (hit && !done.includes(hit.key)) {
      const next = [...done, hit.key];
      setDone(next);
      write(storeKey, next);
    }
  }, [pathname, steps, done, storeKey]);

  if (!steps.length) return null;
  const count = steps.filter((s) => done.includes(s.key)).length;
  return (
    <div className="fixed bottom-4 end-4 z-40 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <div className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-card shadow-xl" role="dialog" aria-label={t("title")} data-testid="demo-guide">
          <div className="flex items-start justify-between gap-3 border-b bg-brand px-4 py-3 text-brand-foreground">
            <div>
              <p className="text-sm font-semibold">{t("title")}</p>
              <p className="text-xs opacity-80">{intro}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="rounded-md p-1 hover:bg-white/10">
              <X className="size-4" />
            </button>
          </div>
          <ol className="max-h-[60vh] divide-y overflow-y-auto">
            {steps.map((s) => {
              const isDone = done.includes(s.key);
              return (
                <li key={s.key}>
                  <Link href={s.href} className="flex gap-3 px-4 py-3 transition hover:bg-muted/50" data-testid={`guide-step-${s.key}`}>
                    {isDone ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className={cn("block text-sm font-medium", isDone && "text-muted-foreground")}>{s.title}</span>
                      <span className="block text-xs text-muted-foreground">{s.body}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span>{t("progress", { done: count, total: steps.length })}</span>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => {
                setDone([]);
                write(storeKey, []);
              }}
            >
              {t("restart")}
            </button>
          </div>
        </div>
      )}
      <Button onClick={() => setOpen((o) => !o)} className="rounded-full shadow-lg" data-testid="demo-guide-toggle" aria-expanded={open}>
        <Compass className="size-4" />
        {t("button")}
        <span className="rounded-full bg-white/20 px-1.5 text-[11px] tabular-nums">
          {count}/{steps.length}
        </span>
      </Button>
    </div>
  );
}
