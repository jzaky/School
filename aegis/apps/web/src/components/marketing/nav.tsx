"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Menu, X } from "lucide-react";

export type NavItem = { href: string; label: string };

export function NavLinks({ items, onNavigate, vertical }: { items: NavItem[]; onNavigate?: () => void; vertical?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={vertical ? "flex flex-col gap-1" : "flex items-center gap-0.5"}>
      {items.map((it) => {
        const current = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href + "/"));
        return (
          <li key={it.href}>
            <Link href={it.href} className={vertical ? "mk-nav-link w-full !h-11 !text-[15px]" : "mk-nav-link"} aria-current={current ? "page" : undefined} onClick={onNavigate}>
              {it.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="lg:hidden">
      <button type="button" className="mk-btn mk-btn-secondary mk-btn-sm !px-2.5" aria-expanded={open} aria-controls={id} aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((v) => !v)}>
        {open ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
      </button>
      {open ? (
        <div id={id} className="absolute inset-x-0 top-16 border-b border-(--mk-line) bg-(--mk-bg) shadow-lg">
          <nav aria-label="Primary" className="mk-wrap py-4">
            <NavLinks items={items} vertical onNavigate={() => setOpen(false)} />
            <div className="mt-4 flex flex-col gap-2 border-t border-(--mk-line) pt-4">
              <Link href="/login" className="mk-btn mk-btn-secondary" onClick={() => setOpen(false)}>
                Sign in
              </Link>
              <Link href="/site/demo" className="mk-btn mk-btn-primary" onClick={() => setOpen(false)}>
                Request a demo
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
