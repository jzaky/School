import Link from "next/link";
import type { ReactNode } from "react";
import { MobileNav, NavLinks } from "./nav";

export const NAV = [
  { href: "/site/products", label: "Products" },
  { href: "/site/demo", label: "Demo" },
  { href: "/site/pilot", label: "Pilot" },
  { href: "/site/architecture", label: "Architecture" },
  { href: "/site/security", label: "Security" },
  { href: "/site/proof", label: "Proof" },
  { href: "/site/contact", label: "Contact" },
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2.5 ${className ?? ""}`} aria-label="AEGIS by Nexus AI Assurance, home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M16 2 L28 7 V16 C28 23 22.5 28 16 30 C9.5 28 4 23 4 16 V7 Z" fill="none" stroke="var(--mk-accent)" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M16 9 L22 20 H10 Z" fill="var(--mk-accent)" />
      </svg>
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-semibold tracking-[0.12em]">AEGIS</span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-(--mk-muted)">by Nexus AI Assurance</span>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-(--mk-line) bg-(--mk-bg)/95 backdrop-blur">
      <div className="mk-wrap flex h-16 items-center justify-between gap-4">
        <Wordmark />
        <nav aria-label="Primary" className="hidden lg:block">
          <NavLinks items={NAV} />
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login" className="mk-nav-link">
            Sign in
          </Link>
          <Link href="/site/pilot" className="mk-btn mk-btn-primary mk-btn-sm">
            Discuss a pilot
          </Link>
        </div>
        <MobileNav items={NAV} />
      </div>
    </header>
  );
}

const FOOTER_GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: "Platform", links: [{ href: "/site/products#control", label: "Control" }, { href: "/site/products#assurance", label: "Assurance" }, { href: "/site/products#shield", label: "Shield" }, { href: "/site/products#audit", label: "Audit" }, { href: "/site/tour", label: "Product tour" }, { href: "/site/checker", label: "Free governance checker" }] },
  { title: "Technical", links: [{ href: "/site/architecture", label: "Architecture" }, { href: "/site/architecture#fail-closed", label: "Fail-closed behaviour" }, { href: "/site/security", label: "Security" }, { href: "/site/security#known-gaps", label: "Known gaps" }, { href: "/site/open-source", label: "Open source and licensing" }, { href: "/site/proof", label: "Proof: what is verified" }] },
  { title: "Company", links: [{ href: "/site/pricing", label: "Enterprise licensing" }, { href: "/site/demo", label: "Explore the demo" }, { href: "/site/pilot", label: "Discuss a pilot" }, { href: "/site/contact", label: "Contact" }, { href: "/login", label: "Console sign in" }] },
  { title: "Legal", links: [{ href: "/site/privacy", label: "Privacy" }, { href: "/site/terms", label: "Terms" }] },
];

export function SiteFooter() {
  return (
    <footer className="mk-dark border-t border-(--mk-line)">
      <div className="mk-wrap py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm text-(--mk-muted)">Define what your AI agents may do. Enforce it before execution. Prove what happened.</p>
          </div>
          {FOOTER_GROUPS.map((g) => (
            <nav key={g.title} aria-label={g.title}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-(--mk-dim)">{g.title}</h2>
              <ul className="mt-3 space-y-2">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-(--mk-muted) hover:text-(--mk-fg)">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-(--mk-line) pt-6 text-xs text-(--mk-dim) md:flex-row md:items-center md:justify-between">
          <p>
            No customers or certifications are claimed; see{" "}
            <Link href="/site/security#known-gaps" className="underline underline-offset-2 hover:text-(--mk-fg)">
              Security
            </Link>{" "}
            for known gaps. Demo data is synthetic. Thresholds shown are illustrative and customer-configurable.
          </p>
          <p>AEGIS by Nexus AI Assurance. Pre-release build.</p>
        </div>
      </div>
    </footer>
  );
}

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="mk flex min-h-screen flex-col">
      <a href="#main" className="mk-skip">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
