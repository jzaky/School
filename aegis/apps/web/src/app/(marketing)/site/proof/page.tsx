import type { Metadata } from "next";
import Link from "next/link";
import { ClosingCta, Note, PageIntro, Pre, Prose, Section, SectionHeading, Table } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Proof", description: "What AEGIS has actually verified: the test suites, the recorded runs, the layout scans and the checks that have not been made yet. Plain statements, no headline percentages." };

const VERIFIED: [string, string, string][] = [
  ["Core test suite", "203 unit and integration tests across policy evaluation, the gateway, approvals, execution safety, evidence, Shield, monitoring, audit, SSO, jobs, connectors, templates and the public checker", "pnpm --filter @aegis/core test"],
  ["Browser suite", "16 Playwright spec files driving the console and the public site through a production build in CI: control, approvals, policies, assurance, audit, Shield, integrations, onboarding, governance, score bands, replay, posture, trading, marketing", "cd apps/web && npx playwright test"],
  ["Tenant isolation", "Row-level security tests: a tenant cannot read, write or count another tenant's rows, and the app role cannot bypass the policies", "pnpm --filter @aegis/db test"],
  ["Refund journey over HTTP", "12 of 12 checks: register an agent, grant a tool, submit a refund below and above the limit, approve, verify the execution grant downstream, read the receipt and the evidence", "npx tsx scripts/smoke-refund-journey.mts"],
  ["Stripe test-mode connector", "Executed through the real gateway against a fake Stripe server: idempotent refunds, lost responses reconciled from Stripe's own records, live keys refused", "npx vitest run tests/stripe-connector.test.ts"],
  ["Alpaca paper connector", "Executed through the real gateway against a fake Alpaca server: orders keyed by the gateway idempotency key, approval-band orders released by a person, lost responses reconciled by order lookup, live keys and the live host refused", "npx vitest run tests/trading.test.ts"],
  ["Layout scan", "0 overlapping or clipped text findings across 30 pages at 390, 768, 1024, 1280 and 1440 px", "node tests/overlap-scan.mjs"],
  ["Demo seed", "461 historical requests, 75 approvals and 18 denials generated through the real gateway with a backdated clock; evidence chain verified after seeding", "pnpm db:seed"],
  ["Framework catalogs", "13 shared catalogs, 383 controls, each an original one-sentence summary with a license note; every public checker reference resolves to a seeded control", "npx vitest run tests/frameworks-checker.test.ts"],
];

const NOT_CLAIMED: string[] = [
  "No customers, paying or otherwise. Meridian Gulf Bank and every person in the demo are fictional.",
  "No government or enterprise deployment. The production URL serves the demo tenant.",
  "No regulatory certification, accreditation or independent audit of AEGIS. The Audit module maps records to framework controls; it does not certify anything.",
  "No proof of AI safety. AEGIS constrains what an agent may do and records what it did; it does not make a model honest or correct.",
  "No live transaction has been made. The Stripe connector runs in test mode and the Alpaca connector on paper accounts, and both refuse live keys.",
  "No institutional partnership with any standards body, regulator, bank or broker.",
];

const NOT_YET: [string, string][] = [
  ["Stripe test-mode run against Stripe's own API", "The connector is verified against a fake Stripe server. The real test-mode run (scripts/stripe-sandbox-check.mts) needs a customer's test key and has not been made."],
  ["Alpaca paper-account run", "Verified against a fake Alpaca server. The real paper run (scripts/alpaca-paper-check.mts) needs a paper key and has not been made."],
  ["Independent penetration test", "Not commissioned. The threat model and known gaps are published on the Security page."],
  ["Load testing at scale", "Measured only on a single developer machine; see docs/PERFORMANCE.md for the numbers and their limits."],
];

export default function ProofPage() {
  return (
    <>
      <PageIntro eyebrow="Proof" title="What has been verified, and what has not" lead={<>Every claim on this site traces to a test, a recorded run or a scan you can repeat from the repository. Where something has not been run yet, it says so here. No headline percentages, no customer logos.</>} />
      <Section tight>
        <SectionHeading eyebrow="Verified" title="Tests and recorded runs" lead="Counts are from the last full run on the main development branch; continuous integration repeats the core and browser suites on every push against a production build of the console." />
        <div className="mt-6">
          <Table head={["What", "What it shows", "Repeat it"]} rows={VERIFIED.map(([what, shows, cmd]) => [what, shows, <code key={cmd} className="text-xs">{cmd}</code>])} caption="Verified test suites and runs" />
        </div>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Not claimed" title="Things AEGIS does not claim" lead="The brief for this product forbids claims that are not backed by something that happened. These are the ones people ask about." />
        <ul className="mt-6 space-y-2">
          {NOT_CLAIMED.map((n) => (
            <li key={n} className="flex gap-3 text-(--mk-fg)">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-(--mk-muted)" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section tight>
        <SectionHeading eyebrow="Not yet" title="Checks that have not been made" lead="Each one has a script or a plan ready; what is missing is a credential, a budget or a third party." />
        <div className="mt-6">
          <Table head={["Check", "Status"]} rows={NOT_YET.map(([a, b]) => [a, b])} caption="Checks not yet made" />
        </div>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Repeat it" title="Verify it yourself" lead="Clone the repository, start the two services and run the suites. The commands below are the ones continuous integration runs." />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Pre label="Core and database">{`pnpm install
pnpm db:migrate && pnpm db:seed
pnpm --filter @aegis/db test
pnpm --filter @aegis/core test`}</Pre>
          <Pre label="Console and site">{`pnpm --filter @aegis/web build
pnpm --filter @aegis/api dev &
pnpm --filter @aegis/web start &
cd apps/web && npx playwright test`}</Pre>
        </div>
        <Prose className="mt-6">
          <p>
            The implementation report in the repository (<code>docs/IMPLEMENTATION_REPORT.md</code>) lists every feature with what was implemented, what was executed and verified, and what remains. The <Link href="/site/security#known-gaps">known gaps</Link> are kept on the Security page.
          </p>
        </Prose>
        <Note title="On numbers" className="mt-6">
          Test counts change with every commit; the figures above are refreshed when this page is edited, not generated live. If a number here disagrees with the repository, the repository is right.
        </Note>
      </Section>
      <ClosingCta title="Check your own agents" body="The free checker asks the fourteen questions these controls answer. It runs in your browser and stores nothing." />
    </>
  );
}
