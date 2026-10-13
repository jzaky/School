import type { Metadata } from "next";
import Link from "next/link";
import { ClosingCta, Note, PageIntro, Pre, Prose, Section, SectionHeading, Table } from "@/components/marketing/primitives";
import { NOT_CLAIMED, NOT_YET, VERIFIED } from "@/content/proof";

export const metadata: Metadata = { title: "Proof", description: "What AEGIS has actually verified: the test suites, the recorded runs, the layout scans and the checks that have not been made yet. Plain statements, no headline percentages." };

export default function ProofPage() {
  return (
    <>
      <PageIntro eyebrow="Proof" title="What has been verified, and what has not" lead={<>Every claim on this site traces to a test, a recorded run or a scan you can repeat from the repository. Where something has not been run yet, it says so here. No headline percentages, no customer logos.</>} />
      <Section tight>
        <SectionHeading eyebrow="Verified" title="Tests and recorded runs" lead="Counts are from the last full run on the main development branch; continuous integration repeats the core and browser suites on every push against a production build of the console." />
        <div className="mt-6">
          <Table head={["What", "What it shows", "Repeat it"]} rows={VERIFIED.map((r) => [r.what, r.shows, <code key={r.repeat} className="text-xs">{r.repeat}</code>])} caption="Verified test suites and runs" />
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
          <Table head={["Check", "Status"]} rows={NOT_YET.map((r) => [r.check, r.status])} caption="Checks not yet made" />
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
          Test counts change with every commit. The figures above live in one content file in the repository, and a check in continuous integration compares them with the real test and catalog counts on every push; the build fails when they drift.
        </Note>
      </Section>
      <ClosingCta title="Check your own agents" body="The free checker asks the fourteen questions these controls answer. It runs in your browser and stores nothing." />
    </>
  );
}
