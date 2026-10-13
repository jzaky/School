import type { Metadata } from "next";
import { BankingWalkthrough, EgressBlock, RefundSlider, TourFooterLinks } from "@/components/marketing/tour";
import { Note, PageIntro, Section, SectionHeading } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Product tour", description: "Step through the AEGIS banking scenario: an AED 250,000 transfer needs approval, a person decides, and a receipt and evidence are recorded. Try the refund tiers and see how an attempt to move customer data out is stopped." };

export default function TourPage() {
  return (
    <>
      <PageIntro eyebrow="Interactive product tour" title="One transfer, start to finish" lead="The banking scenario from the demo tenant (made-up data), using the real request and reply formats from the API. The live version runs in the console through the actual gateway.">
        <p className="mt-6 inline-flex rounded-md border border-(--mk-approval)/50 bg-(--mk-approval)/10 px-3 py-2 text-sm text-(--mk-fg)">Illustration of the live flow; thresholds are customer-configurable examples. Nothing on this page calls the gateway.</p>
      </PageIntro>
      <Section>
        <SectionHeading eyebrow="Scenario 1" title="Treasury transfer of AED 250,000" lead="Below AED 50,000 in business hours, the agent acts on its own. Up to AED 1,000,000, a person must approve. Above that, the transfer is refused. These are example thresholds from the demo policy treasury-transfer-limits." />
        <div className="mt-8">
          <BankingWalkthrough />
        </div>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Scenario 2" title="Refund tiers: which rule decides?" lead="Move the amount and watch the deciding rule change. Below AED 500, the refund is allowed. From AED 500 to 2,500, an approver must agree. Above AED 2,500, it is refused. These are example thresholds from the demo policy refund-authority." />
        <div className="mt-8">
          <RefundSlider />
        </div>
        <Note className="mt-6" title="Also in the live refund scenario">
          If the agent sends the same request again, it gets the original answer and the support platform is not called twice (the idempotency key). An approval that has expired cannot be used afterwards. Replaying an approved request with a different amount is rejected and needs a fresh decision.
        </Note>
      </Section>
      <Section>
        <SectionHeading eyebrow="Scenario 3" title="Moving customer data out is stopped before it happens" lead="Two attempts by a marketing agent to move customer data outside the organization (data egress), and how destination rules, the Shield data check and the policy combine to refuse them." />
        <div className="mt-8">
          <EgressBlock />
        </div>
      </Section>
      <Section dark>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="mk-h2">Run it for real</h2>
            <p className="mk-lead mt-3">The console runs these scenarios for real: through the gateway, the policy engine, the approval service and the simulated downstream systems. You watch the evidence record grow as you go. Demo data is made up (synthetic) and labelled.</p>
          </div>
          <TourFooterLinks />
        </div>
      </Section>
    </>
  );
}
