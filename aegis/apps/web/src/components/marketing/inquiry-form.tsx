"use client";
import { useId, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { submitMarketingForm, type MarketingResult } from "@/server/actions/marketing";
import { DEPLOYMENTS, INTERESTS } from "./form-options";

export function InquiryForm({ kind, submitLabel }: { kind: "inquiry" | "demo_request" | "pilot_request"; submitLabel?: string }) {
  const scheduled = kind === "demo_request" || kind === "pilot_request";
  const id = useId();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MarketingResult | null>(null);
  const f = (name: string) => `${id}-${name}`;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = { kind, path: pathname };
    for (const [k, v] of fd.entries()) payload[k] = typeof v === "string" ? v : "";
    start(async () => {
      const r = await submitMarketingForm(payload);
      setResult(r);
    });
  }

  if (result?.ok) {
    return (
      <div className="mk-card-soft" role="status" data-testid="form-confirmation">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-(--mk-allow)" aria-hidden />
          <div>
            <h3 className="mk-h3">{kind === "pilot_request" ? "Pilot request received" : kind === "demo_request" ? "Demo request received" : "Message received"}</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">Thank you. A person will reply by email, usually within two working days. {result.data.reference !== "received" ? `Your reference is ${result.data.reference}.` : ""} Nothing else is sent automatically.</p>
            <p className="mt-3 text-sm">
              Meanwhile, the{" "}
              <Link href="/site/demo" className="underline underline-offset-2">
                guided demo
              </Link>{" "}
              walks through the refund workflow on the synthetic tenant.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mk-card relative space-y-5" noValidate aria-describedby={f("privacy")}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={f("name")} className="mk-label">
            Full name
          </label>
          <input id={f("name")} name="name" className="mk-input" autoComplete="name" required maxLength={120} />
        </div>
        <div>
          <label htmlFor={f("email")} className="mk-label">
            Work email
          </label>
          <input id={f("email")} name="email" type="email" className="mk-input" autoComplete="email" required maxLength={254} />
        </div>
        <div>
          <label htmlFor={f("organization")} className="mk-label">
            Organization
          </label>
          <input id={f("organization")} name="organization" className="mk-input" autoComplete="organization" required maxLength={160} />
        </div>
        <div>
          <label htmlFor={f("role")} className="mk-label">
            Role
          </label>
          <input id={f("role")} name="role" className="mk-input" autoComplete="organization-title" required maxLength={120} />
        </div>
        <div className={scheduled ? "" : "sm:col-span-2"}>
          <label htmlFor={f("interest")} className="mk-label">
            Area of interest
          </label>
          <select id={f("interest")} name="interest" className="mk-input" required defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            {INTERESTS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        {scheduled ? (
          <>
            <div>
              <label htmlFor={f("deploymentPreference")} className="mk-label">
                Deployment preference
              </label>
              <select id={f("deploymentPreference")} name="deploymentPreference" className="mk-input" required defaultValue="">
                <option value="" disabled>
                  Choose one
                </option>
                {DEPLOYMENTS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={f("preferredDates")} className="mk-label">
                Preferred dates
              </label>
              <input id={f("preferredDates")} name="preferredDates" className="mk-input" placeholder="For example: week of 3 November, mornings Gulf time" required maxLength={300} />
              <p className="mk-hint mt-1.5">Give one or two options and your time zone. Sessions run about 45 minutes.</p>
            </div>
          </>
        ) : null}
        <div className="sm:col-span-2">
          <label htmlFor={f("message")} className="mk-label">
            Message <span className="font-normal text-(--mk-dim)">(optional)</span>
          </label>
          <textarea id={f("message")} name="message" className="mk-input" maxLength={4000} placeholder={kind === "pilot_request" ? "Which agent issues refunds today, which payment or support system it uses, who would approve, and when you could start." : kind === "demo_request" ? "Which agents or systems you want to see governed, who will attend, anything specific to cover." : "How can we help?"} />
        </div>
      </div>
      {/* Honeypot: hidden from people and assistive technology, filled only by bots. */}
      <div className="absolute -start-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor={f("website")}>Website</label>
        <input id={f("website")} name="website" type="text" tabIndex={-1} autoComplete="off" data-testid="honeypot" />
      </div>
      {result && !result.ok ? (
        <p role="alert" className="rounded-md border border-(--mk-deny)/40 bg-(--mk-deny)/10 px-3 py-2 text-sm text-(--mk-deny)">
          {result.error}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p id={f("privacy")} className="mk-hint max-w-md">
          Your details are stored once so a person can reply by email. No automated emails, no marketing lists. See the{" "}
          <Link href="/site/privacy" className="underline underline-offset-2">
            privacy notice
          </Link>
          .
        </p>
        <button type="submit" className="mk-btn mk-btn-primary" disabled={pending}>
          {pending ? "Sending" : submitLabel ?? (kind === "pilot_request" ? "Discuss a pilot" : kind === "demo_request" ? "Request a demo" : "Send message")}
        </button>
      </div>
    </form>
  );
}
