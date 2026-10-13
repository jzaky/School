import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const SITE_URL = process.env.WEB_PUBLIC_URL ?? "http://localhost:3000";

export function Section({ id, children, className, dark, tight }: { id?: string; children: ReactNode; className?: string; dark?: boolean; tight?: boolean }) {
  return (
    <section id={id} className={cn("mk-section", dark && "mk-dark", tight && "!py-10", className)}>
      <div className="mk-wrap">{children}</div>
    </section>
  );
}

export function SectionHeading({ eyebrow, title, lead, id, as = "h2" }: { eyebrow?: string; title: string; lead?: ReactNode; id?: string; as?: "h1" | "h2" }) {
  const Tag = as;
  return (
    <div className="max-w-3xl">
      {eyebrow ? <p className="mk-eyebrow mb-3">{eyebrow}</p> : null}
      <Tag id={id} className={as === "h1" ? "mk-h1" : "mk-h2"}>
        {title}
      </Tag>
      {lead ? <p className="mk-lead mt-4">{lead}</p> : null}
    </div>
  );
}

export function ButtonLink({ href, children, variant = "primary", size, className, external }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; size?: "sm"; className?: string; external?: boolean }) {
  const cls = cn("mk-btn", variant === "primary" ? "mk-btn-primary" : "mk-btn-secondary", size === "sm" && "mk-btn-sm", className);
  if (external) {
    return (
      <a href={href} className={cls} rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "allow" | "deny" | "approval" | "accent"; children: ReactNode; className?: string }) {
  return <span className={cn("mk-pill", tone !== "neutral" && `mk-pill-${tone}`, className)}>{children}</span>;
}

export function Note({ title = "Honesty note", children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <aside className={cn("rounded-lg border border-(--mk-line) border-s-4 border-s-(--mk-approval) bg-(--mk-bg-2) px-4 py-3 text-sm", className)} aria-label={title}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-(--mk-muted)">{children}</div>
    </aside>
  );
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mk-prose max-w-3xl text-[15px] text-(--mk-muted)", className)}>{children}</div>;
}

export function Pre({ children, label, className }: { children: string; label?: string; className?: string }) {
  return (
    <figure className={className}>
      {label ? <figcaption className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-(--mk-dim)">{label}</figcaption> : null}
      <pre className="mk-pre" tabIndex={0}>
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="mk-table-wrap">
      <table className="mk-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? "font-medium text-(--mk-fg)" : "text-(--mk-muted)"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageIntro({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <Section dark className="!pt-14 !pb-12 md:!pt-20 md:!pb-16">
      <SectionHeading as="h1" eyebrow={eyebrow} title={title} lead={lead} />
      {children}
    </Section>
  );
}

export function ClosingCta({ title, body }: { title?: string; body?: string }) {
  return (
    <Section dark>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="mk-h2">{title ?? "See a refund go through the gateway, then run a pilot on test-mode money."}</h2>
          <p className="mk-lead mt-3">{body ?? "The hosted demo walks the refund workflow end to end on a synthetic tenant: request, decision, approval, receipt, evidence. A pilot connects your own test-mode payment account."}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <ButtonLink href="/site/demo">Explore the demo</ButtonLink>
          <ButtonLink href="/site/pilot" variant="secondary">
            Discuss a pilot
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
