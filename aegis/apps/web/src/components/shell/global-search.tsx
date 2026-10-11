"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { globalSearchAction, type SearchHit } from "@/server/actions/search";
import { CommandPalette, type PaletteGroup } from "@/components/ui/command-palette";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { navItemState } from "./sidebar-nav";
import type { ShellData } from "./types";

export function GlobalSearch({ data }: { data: ShellData }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<{ agents: SearchHit[]; members: SearchHit[] }>({ agents: [], members: [] });
  const [loading, setLoading] = React.useState(false);
  const pendingKey = React.useRef<string | null>(null);

  // Keyboard: Cmd/Ctrl+K opens the palette; "g a" and "g o" are navigation chords.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (pendingKey.current === "g") {
        pendingKey.current = null;
        if (e.key === "a" && data.org) router.push("/agents");
        if (e.key === "o" && data.org) router.push("/overview");
        return;
      }
      if (e.key === "g") {
        pendingKey.current = "g";
        setTimeout(() => {
          pendingKey.current = null;
        }, 800);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, data.org]);

  React.useEffect(() => {
    if (!open || !data.org) return;
    const q = query.trim();
    if (!q) {
      setHits({ agents: [], members: [] });
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await globalSearchAction(q);
      if (cancelled) return;
      setLoading(false);
      if (r.ok) setHits(r.data);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open, data.org]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  const lq = query.trim().toLowerCase();
  const navItems = ALL_NAV_ITEMS.filter((i) => (!i.platformAdmin || data.user.isPlatformAdmin) && (!lq || i.label.toLowerCase().includes(lq) || i.href.includes(lq)))
    .slice(0, lq ? 8 : 12)
    .map((i) => {
      const st = navItemState(i, data);
      return { id: `nav:${i.href}`, label: i.label, hint: i.href, disabled: st.disabled, disabledReason: st.reason, onSelect: () => go(i.href) };
    });
  const groups: PaletteGroup[] = [
    { heading: "Agents", items: hits.agents.map((h) => ({ id: `agent:${h.id}`, label: h.label, hint: h.hint, onSelect: () => go(h.href) })) },
    { heading: "People", items: hits.members.map((h) => ({ id: `member:${h.id}`, label: h.label, hint: h.hint, onSelect: () => go(h.href) })) },
    { heading: "Go to", items: navItems },
  ];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search (Ctrl or Cmd K)" className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-bg px-2.5 text-sm text-fg-dim transition-colors duration-150 hover:border-line-strong hover:text-fg-muted md:w-64">
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden flex-1 text-start md:inline">Search</span>
        <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] md:inline">Ctrl K</kbd>
      </button>
      <CommandPalette open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }} groups={groups} query={query} onQueryChange={setQuery} loading={loading} placeholder={data.org ? "Search agents, people and pages" : "Search pages"} />
    </>
  );
}
