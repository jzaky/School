"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";

/** Two-key shortcuts ("g" then a letter) and "?" for help. Ignored while typing in a field. */
export const SHORTCUTS: { keys: string; label: string; href: string }[] = [
  { keys: "g o", label: "Overview", href: "/overview" },
  { keys: "g c", label: "Control Center", href: "/control-center" },
  { keys: "g a", label: "Approvals", href: "/approvals" },
  { keys: "g g", label: "Action Gateway", href: "/gateway" },
  { keys: "g p", label: "Policies", href: "/policies" },
  { keys: "g s", label: "Security Events", href: "/security/events" },
  { keys: "g e", label: "Evidence Ledger", href: "/evidence" },
  { keys: "g h", label: "System Health", href: "/org/health" },
];

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.getAttribute("role") === "combobox");
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (pendingG && Date.now() - pendingG < 1200) {
        const hit = SHORTCUTS.find((s) => s.keys === `g ${e.key}`);
        pendingG = 0;
        if (hit) {
          e.preventDefault();
          router.push(hit.href);
        }
        return;
      }
      if (e.key === "g") pendingG = Date.now();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" description="Press g, then a letter. Press Ctrl K (Cmd K on a Mac) to search.">
      <ul className="grid gap-2 text-sm sm:grid-cols-2" data-testid="shortcut-list">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between gap-3">
            <span className="text-fg">{s.label}</span>
            <kbd className="rounded border border-line bg-bg-elev-2 px-1.5 py-0.5 font-mono text-xs text-fg-muted">{s.keys}</kbd>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3">
          <span className="text-fg">This list</span>
          <kbd className="rounded border border-line bg-bg-elev-2 px-1.5 py-0.5 font-mono text-xs text-fg-muted">?</kbd>
        </li>
      </ul>
    </Dialog>
  );
}
