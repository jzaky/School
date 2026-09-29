"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Columns3, Globe2, Loader2, Search, X } from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Opt = { value: string; label: string };

function useParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = useCallback(
    (entries: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(entries)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      next.delete("page");
      start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [sp, pathname, router],
  );
  return { set, sp, pending };
}

/** Debounced text search. Changing it goes back to page 1. */
export function SearchBox({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const ref = useRef<HTMLInputElement>(null);
  const urlQ = () => new URLSearchParams(window.location.search).get("q") ?? "";
  const pending = q.trim() !== (sp.get("q") ?? "");
  // Text typed before the page finished loading is picked up once React takes over the input.
  useEffect(() => {
    const typed = ref.current?.value ?? "";
    if (typed !== q) setQ(typed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const want = q.trim();
    // Compare with the address bar itself, which is never stale.
    if (urlQ() === want) return;
    const go = () => {
      const next = new URLSearchParams(window.location.search);
      if (want) next.set("q", want);
      else next.delete("q");
      next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    };
    const h = setTimeout(go, 350);
    // A navigation asked for while the page is still starting up can be dropped: ask again.
    const retry = setInterval(() => {
      if (urlQ() === want) clearInterval(retry);
      else go();
    }, 2000);
    return () => {
      clearTimeout(h);
      clearInterval(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="relative min-w-0 flex-1">
      {pending ? <Loader2 className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
      <Input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="ps-9" data-testid="program-search" />
    </div>
  );
}

/** A URL-driven select. With allLabel, an "all" option clears the parameter. */
export function ParamSelect({ param, label, options, allLabel, value, testId, className }: { param: string; label: string; options: Opt[]; allLabel?: string; value?: string; testId?: string; className?: string }) {
  const { set, sp } = useParams();
  const current = sp.get(param) ?? value ?? (allLabel ? "all" : (options[0]?.value ?? ""));
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={current} onValueChange={(v) => set({ [param]: v === "all" ? null : v })}>
        <SelectTrigger size="sm" className="w-full" data-testid={testId ?? `filter-${param}`} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allLabel && <SelectItem value="all">{allLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Several countries at once (?country=GB,US). */
export function CountryFilter({ options, label, allLabel }: { options: Opt[]; label: string; allLabel: string }) {
  const t = useTranslations("discovery");
  const { set, sp } = useParams();
  const picked = (sp.get("country") ?? "").split(",").filter(Boolean);
  const [open, setOpen] = useState(false);
  const toggle = (c: string) => {
    const next = picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c];
    set({ country: next.length ? next.join(",") : null });
  };
  const summary = picked.length === 0 ? allLabel : picked.length <= 2 ? picked.map((c) => options.find((o) => o.value === c)?.label ?? c).join(t("listSep")) : t("countriesN", { n: picked.length });
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between font-normal" data-testid="filter-country" aria-label={label}>
            <span className="flex min-w-0 items-center gap-1.5">
              <Globe2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{summary}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          <ul className="max-h-72 overflow-y-auto" data-testid="country-options">
            {options.map((o) => {
              const on = picked.includes(o.value);
              return (
                <li key={o.value}>
                  <button type="button" onClick={() => toggle(o.value)} aria-pressed={on} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted" data-testid={`country-${o.value}`}>
                    <span className={cn("grid size-4 place-content-center rounded border", on && "border-brand bg-brand text-brand-foreground")}>{on && <Check className="size-3" />}</span>
                    {o.label}
                  </button>
                </li>
              );
            })}
          </ul>
          {picked.length > 0 && (
            <div className="border-t p-1">
              <button type="button" className="w-full rounded-md px-2 py-1.5 text-start text-xs text-brand hover:bg-muted" onClick={() => set({ country: null })}>
                {t("clearCountries")}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Compare selection (kept in session storage so it survives paging and filtering)

type Picked = { id: string; name: string };
const MAX = 4;
const KEY = "discovery.compare";
type CompareState = { picked: Picked[]; toggle: (p: Picked) => void; clear: () => void };
const CompareContext = createContext<CompareState | null>(null);

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [picked, setPicked] = useState<Picked[]>([]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) setPicked((JSON.parse(raw) as Picked[]).filter((p) => p && typeof p.id === "string").slice(0, MAX));
    } catch {
      // Storage can be unavailable (private windows); the selection then lasts for this page only.
    }
  }, []);
  const save = (next: Picked[]) => {
    setPicked(next);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // See above.
    }
  };
  const value = useMemo<CompareState>(
    () => ({
      picked,
      toggle: (p) => save(picked.some((x) => x.id === p.id) ? picked.filter((x) => x.id !== p.id) : picked.length >= MAX ? picked : [...picked, p]),
      clear: () => save([]),
    }),
    [picked],
  );
  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function CompareToggle({ id, name }: { id: string; name: string }) {
  const t = useTranslations("discovery");
  const ctx = useContext(CompareContext);
  if (!ctx) return null;
  const on = ctx.picked.some((p) => p.id === id);
  const full = !on && ctx.picked.length >= MAX;
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm", full ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer")} title={full ? t("compareFull") : undefined} data-testid="compare-toggle">
      <Checkbox checked={on} disabled={full} onCheckedChange={() => ctx.toggle({ id, name })} aria-label={t("compareWith", { name })} />
      {t("compare")}
    </label>
  );
}

/** Sticky bar with the programmes picked for comparison. The button works with 2 to 4. */
export function CompareTray({ studentParam }: { studentParam: string | null }) {
  const t = useTranslations("discovery");
  const ctx = useContext(CompareContext);
  if (!ctx || ctx.picked.length === 0) return null;
  const ready = ctx.picked.length >= 2;
  const href = `/career/pathways/compare?ids=${ctx.picked.map((p) => p.id).join(",")}${studentParam ? `&student=${studentParam}` : ""}`;
  return (
    <div className="sticky bottom-3 z-20 mt-2 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur" data-testid="compare-tray">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="me-1 text-sm font-medium">{t("trayTitle", { n: ctx.picked.length, max: MAX })}</span>
          {ctx.picked.map((p) => (
            <span key={p.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              <span className="max-w-[12rem] truncate">{p.name}</span>
              <button type="button" onClick={() => ctx.toggle(p)} aria-label={t("removeFromCompare", { name: p.name })} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={ctx.clear}>
            {t("clear")}
          </Button>
          {ready ? (
            <Button asChild size="sm">
              <Link href={href} data-testid="open-compare">
                <Columns3 className="size-4" />
                {t("compareN", { n: ctx.picked.length })}
              </Link>
            </Button>
          ) : (
            <span title={t("pickTwo")} tabIndex={0}>
              <Button size="sm" disabled data-testid="open-compare">
                <Columns3 className="size-4" />
                {t("compareN", { n: ctx.picked.length })}
              </Button>
            </span>
          )}
        </div>
      </div>
      {!ready && <p className="mt-1 text-xs text-muted-foreground">{t("pickTwo")}</p>}
    </div>
  );
}

/** Mobile comparison: one programme at a time, with a switcher. */
export function CompareSwitcher({ labels, panels }: { labels: string[]; panels: React.ReactNode[] }) {
  const [i, setI] = useState(0);
  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1" role="tablist" data-testid="compare-switcher">
        {labels.map((l, j) => (
          <button key={j} type="button" role="tab" aria-selected={i === j} onClick={() => setI(j)} className={cn("min-w-0 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium", i === j ? "bg-card shadow-xs" : "text-muted-foreground")}>
            <span className="block max-w-[10rem] truncate">{l}</span>
          </button>
        ))}
      </div>
      {panels.map((p, j) => (
        <div key={j} hidden={i !== j} role="tabpanel">
          {p}
        </div>
      ))}
    </div>
  );
}
