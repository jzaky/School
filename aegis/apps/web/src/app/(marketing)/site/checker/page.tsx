import type { Metadata } from "next";
import { CHECKER_FRAMEWORKS } from "@aegis/core/audit/checker";
import { ClosingCta, Note, PageIntro, Section, SectionHeading } from "@/components/marketing/primitives";
import { GovernanceChecker } from "@/components/marketing/governance-checker";

export const metadata: Metadata = { title: "Free AI agent governance checker", description: "Fourteen plain questions about the AI agents you run. Your answers are scored in your browser and matched to ISO/IEC 42001, ISO/IEC 27001, NIST AI RMF, the EU AI Act, GDPR, the UAE PDPL, Dubai DESC ISR and further ISO guidance. Nothing is stored." };

export default function CheckerPage() {
  return (
    <>
      <PageIntro eyebrow="Free checker" title="How well governed are your AI agents?" lead={<>Fourteen questions a regulator, an auditor or your own board would ask about AI agents that can take actions. Answer them here. Your score, your gaps and your coverage of each framework are worked out in your browser and never sent anywhere.</>} />
      <Section tight>
        <Note title="What this is">
          A self-check you score yourself. Each question is matched to AEGIS&apos;s own one-sentence summaries of {CHECKER_FRAMEWORKS.length} public frameworks ({CHECKER_FRAMEWORKS.map((f) => f.name).join(", ")}). It is not a compliance opinion, not a certification and not legal advice. No account, no email, no cookie: there is nothing to sign up for.
        </Note>
        <div className="mt-8">
          <GovernanceChecker />
        </div>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Why these questions" title="Fourteen controls that decide whether an agent can do damage" lead="Each question matches a control in the catalog that ships with the AEGIS Audit module. Inside the product, the same catalog checks your own policy documents, and most of the technical controls are confirmed from live records rather than from what a document says." />
      </Section>
      <ClosingCta title="See the controls in a running system" body="In the hosted demo, every one of these controls runs on a fictional bank's agents, and you can see the evidence behind each decision." />
    </>
  );
}
