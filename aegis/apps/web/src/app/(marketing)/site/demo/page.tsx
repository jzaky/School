import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Note, PageIntro, Pill, Section, SectionHeading } from "@/components/marketing/primitives";
import { Screenshot, type ScreenKey } from "@/components/marketing/screenshot";

export const metadata: Metadata = { title: "Explore the demo", description: "A guided walkthrough of the refund workflow in the AEGIS console on a synthetic tenant: sample workflow, approval, receipt, evidence, thresholds, emergency pause and export." };

const STEPS: { n: number; title: string; where: string; what: string; screen: ScreenKey }[] = [
  { n: 1, title: "Open the setup checklist", where: "Getting started", what: "Seven steps from exploring the sample workflow to exporting evidence. Each step knows whether it is done from the data, not from a flag you tick.", screen: "gettingStarted" },
  { n: 2, title: "Run the sample refund workflow", where: "More, then Action Gateway, then Demos, then Refunds", what: "Six refunds go through the real gateway against the simulated support platform: an AED 180 refund executes on its own, a replay returns the original result, a second refund for the same order is refused, AED 1,450 waits for an approver, AED 6,200 is denied, and an expired approval cannot be used. No external credentials are involved.", screen: "overview" },
  { n: 3, title: "Approve the AED 1,450 refund as Lina Mansour", where: "Approvals", what: "Sign in as the approver persona. The request reads in words: what refund, how much, which order and customer, the reason the agent gave, and which policy rule asked for a human. Approve with a comment. The gateway executes once and shows the receipt.", screen: "approvalDetail" },
  { n: 4, title: "Follow the request to its receipt and evidence", where: "Open the action request", what: "The single execution grant, consumed before the call; the downstream receipt with the provider reference; and every evidence entry for this request in the hash chain.", screen: "requestDetail" },
  { n: 5, title: "Change the thresholds and try a request", where: "More, then Policies, then Customer refund authority, then Thresholds", what: "Move the autonomous limit, pick who may approve, toggle duplicate and reason rules, and see sample requests change outcome live. Save a draft version; activation still needs a second person.", screen: "policyThresholds" },
  { n: 6, title: "Pause the gateway during an outstanding approval", where: "Settings, then Emergency controls", what: "Run the sample workflow again, then pause. Approving the pending refund is refused while paused, outstanding execution grants are voided, and the request stays approved-but-unexecuted until an administrator resumes and runs it.", screen: "overview" },
  { n: 7, title: "Verify and export the evidence", where: "More, then Evidence Ledger", what: "Recompute the chain, see the signed checkpoints, export JSON Lines or CSV with the public key. Anyone can verify the export without AEGIS.", screen: "evidence" },
];

const PERSONAS = [
  ["Nadia Haddad", "Owner", "nadia.haddad@meridian-demo.example", "Everything, including policy activation and the emergency pause"],
  ["Lina Mansour", "Approver", "lina.mansour@meridian-demo.example", "Decides approvals; cannot change policy"],
  ["Karim Nassar", "Engineer", "karim.nassar@meridian-demo.example", "Agents, tools and integrations, including the Stripe connection test"],
  ["Sara Khalil", "Viewer", "sara.khalil@meridian-demo.example", "Read only; try to approve and watch it refuse"],
];

export default function DemoPage() {
  const hosted = process.env.AEGIS_DEMO_MODE === "true" || process.env.AEGIS_DEMO_MODE === "1";
  return (
    <>
      <PageIntro eyebrow="Explore the demo" title="A refund, end to end, in the console" lead="The hosted demo is the real product running on a synthetic tenant, Meridian Gulf Bank. Everything you click goes through the actual gateway, policy engine, approval service and evidence ledger. Nothing is pre-recorded.">
        <div className="mt-6 flex flex-wrap gap-3">
          {hosted ? (
            <ButtonLink href="/login">Sign in to the demo console</ButtonLink>
          ) : (
            <ButtonLink href="/site/pilot">Request access to a hosted demo</ButtonLink>
          )}
          <ButtonLink href="/site/tour" variant="secondary">
            Static tour (no sign-in)
          </ButtonLink>
        </div>
      </PageIntro>

      {hosted ? (
        <Section tight>
          <SectionHeading eyebrow="Sign in" title="Demo personas" lead="All people and data are fictional. The console labels the tenant as synthetic demo data on every screen. Changes you make are reset periodically." />
          <div className="mk-table-wrap mt-6">
            <table className="mk-table">
              <caption className="sr-only">Demo personas</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Email</th>
                  <th scope="col">What they can do</th>
                </tr>
              </thead>
              <tbody>
                {PERSONAS.map(([name, role, email, can]) => (
                  <tr key={email}>
                    <td className="font-medium text-(--mk-fg)">{name}</td>
                    <td>{role}</td>
                    <td className="font-mono text-xs">{email}</td>
                    <td className="text-(--mk-muted)">{can}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mk-hint mt-3">
            Password for every persona: <code className="mk-code">AegisDemo2026!</code>. Shown here only because this deployment runs in demo mode on synthetic data.
          </p>
        </Section>
      ) : null}

      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Guided demonstration" title="Seven steps, about fifteen minutes" lead="Follow these in the console. The screenshots are real captures from the demo tenant." />
        <ol className="mt-10 space-y-12">
          {STEPS.map((s) => (
            <li key={s.n} className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start" data-demo-step={s.n}>
              <div>
                <div className="flex items-center gap-3">
                  <span className="shrink-0 font-mono text-xs text-(--mk-accent)">{String(s.n).padStart(2, "0")}</span>
                  <Pill tone="neutral">{s.where}</Pill>
                </div>
                <h3 className="mk-h3 mt-3">{s.title}</h3>
                <p className="mt-2 text-sm text-(--mk-muted)">{s.what}</p>
              </div>
              <Screenshot screen={s.screen} priority={s.n === 1} />
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-2">
          <Note title="What the demo is">
            The current build: agent registry, deterministic policy, the Action Gateway with single-use grants and reconciliation, the Approval Center, emergency controls, the evidence ledger, data protection, incidents and document assessment. Downstream systems in the demo are simulated except Stripe, which runs in test mode once a test key is connected.
          </Note>
          <Note title="What the demo is not">
            Not a customer deployment, not independently audited, and no certification is claimed. Thresholds are illustrative. The simulated support platform is an in-process stand-in that behaves like a real system (grant verification, idempotency) but is not one.
          </Note>
        </div>
        <p className="mt-8 text-sm text-(--mk-muted)">
          Ready to run it on your own test-mode payment account?{" "}
          <Link href="/site/pilot" className="underline underline-offset-2">
            Discuss a pilot
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
