import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Note, PageIntro, Pill, Section, SectionHeading } from "@/components/marketing/primitives";
import { Screenshot, type ScreenKey } from "@/components/marketing/screenshot";

export const metadata: Metadata = { title: "Explore the demo", description: "A guided walkthrough of the refund workflow in the AEGIS console, on a demo tenant with made-up data: sample workflow, approval, receipt, evidence, thresholds, emergency pause and export." };

const STEPS: { n: number; title: string; where: string; what: string; screen: ScreenKey }[] = [
  { n: 1, title: "Open the setup checklist", where: "Getting started", what: "Seven steps, from running the sample workflow to exporting evidence. Each step works out whether it is done from the actual data, not from a box you tick.", screen: "gettingStarted" },
  { n: 2, title: "Run the sample refund workflow", where: "More, then Action Gateway, then Demos, then Refunds", what: "Six refunds go through the real gateway to the simulated support platform: an AED 180 refund is carried out on its own, a repeated request gets the original answer, a second refund for the same order is refused, AED 1,450 waits for an approver, AED 6,200 is refused, and an expired approval cannot be used. No outside systems or credentials are involved.", screen: "overview" },
  { n: 3, title: "Approve the AED 1,450 refund as Lina Mansour", where: "Approvals", what: "Sign in as the approver persona. The request reads in plain words: what refund, how much, which order and customer, the reason the agent gave, and which policy rule asked for a person. Approve with a comment. The gateway carries it out once and shows the receipt.", screen: "approvalDetail" },
  { n: 4, title: "Follow the request to its receipt and evidence", where: "Open the action request", what: "The one-time permission slip (the execution grant), used up before the call; the receipt from the support platform with its reference; and every evidence entry for this request in the record that shows any edit (the hash chain).", screen: "requestDetail" },
  { n: 5, title: "Change the thresholds and try a request", where: "More, then Policies, then Customer refund authority, then Thresholds", what: "Move the limit for refunds the agent may make on its own, pick who may approve, switch the duplicate and reason rules on or off, and watch the outcome of sample requests change as you go. Save a draft version; a second person must switch it on.", screen: "policyThresholds" },
  { n: 6, title: "Pause the gateway during an outstanding approval", where: "Settings, then Emergency controls", what: "Run the sample workflow again, then pause. While paused, approving the pending refund is refused and outstanding permission slips (execution grants) are cancelled. The request stays approved but not carried out until an administrator resumes and runs it.", screen: "overview" },
  { n: 7, title: "Verify and export the evidence", where: "More, then Evidence Ledger", what: "Recompute the record to prove nothing has been changed (the chain), see the signed checkpoints, and export it as JSON Lines or CSV with the public key. Anyone can check the export without AEGIS.", screen: "evidence" },
];

const PERSONAS = [
  ["Nadia Haddad", "Owner", "nadia.haddad@meridian-demo.example", "Everything, including switching on policies and the emergency pause"],
  ["Lina Mansour", "Approver", "lina.mansour@meridian-demo.example", "Decides approvals; cannot change policy"],
  ["Karim Nassar", "Engineer", "karim.nassar@meridian-demo.example", "Agents, tools and connected systems, including the Stripe connection test"],
  ["Sara Khalil", "Viewer", "sara.khalil@meridian-demo.example", "Read only; try to approve and watch it refuse"],
];

export default function DemoPage() {
  const hosted = process.env.AEGIS_DEMO_MODE === "true" || process.env.AEGIS_DEMO_MODE === "1";
  return (
    <>
      <PageIntro eyebrow="Explore the demo" title="A refund, end to end, in the console" lead="The hosted demo is the real product running on a demo tenant with made-up data, Meridian Gulf Bank. Everything you click goes through the actual gateway, policy engine, approval service and evidence ledger. Nothing is pre-recorded.">
        <div className="mt-6 flex flex-wrap gap-3">
          {hosted ? (
            <ButtonLink href="/login">Sign in to the demo console</ButtonLink>
          ) : (
            <ButtonLink href="/site/pilot">Request access to a hosted demo</ButtonLink>
          )}
          <ButtonLink href="/site/tour" variant="secondary">
            Read the tour instead (no sign-in needed)
          </ButtonLink>
        </div>
      </PageIntro>

      {hosted ? (
        <Section tight>
          <SectionHeading eyebrow="Sign in" title="Demo personas" lead="All people and data are fictional. The console marks the tenant as synthetic demo data on every screen. Changes you make are reset from time to time." />
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
            Password for every persona: <code className="mk-code">AegisDemo2026!</code>. It is shown here only because this deployment runs in demo mode on made-up data.
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
            The current build: the register of agents, a policy engine that gives the same request the same answer every time, the Action Gateway (the one door every agent action goes through) with one-time permission slips and a check against the other system of what actually happened (single-use grants and reconciliation), the Approval Center, emergency controls, the evidence ledger, data protection, incidents and document assessment. The systems the demo connects to are simulated, except Stripe, which runs in test mode once a test key is connected.
          </Note>
          <Note title="What the demo is not">
            Not a customer deployment, not independently audited, and no certification is claimed. Thresholds are examples. The simulated support platform is a stand-in that runs inside AEGIS and behaves like a real system (it checks the permission slip and never carries out the same request twice) but it is not one.
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
