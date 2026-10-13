import type { Metadata } from "next";
import { BankingWalkthrough, EgressBlock, RefundSlider, TourFooterLinks } from "@/components/marketing/tour";
import { Note, PageIntro, Section, SectionHeading } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Product tour", description: "Step through the AEGIS banking scenario: an AED 250,000 transfer requires approval, an approver decides, a receipt and evidence are recorded. Try the refund tiers and see how data egress is blocked." };

export default function TourPage() {
  return (
    <>
      <PageIntro eyebrow="Interactive product tour" title="One transfer, start to finish" lead="The banking scenario from the synthetic demo tenant, with the real request and response shapes from the API. The live version runs in the console through the actual gateway.">
        <p className="mt-6 inline-flex rounded-md border border-(--mk-approval)/50 bg-(--mk-approval)/10 px-3 py-2 text-sm text-(--mk-fg)">Illustration of the live flow; thresholds are customer-configurable examples. Nothing on this page calls the gateway.</p>
      </PageIntro>
      <Section>
        <SectionHeading eyebrow="Scenario 1" title="Treasury transfer of AED 250,000" lead="Autonomous below AED 50,000 in business hours, approval up to AED 1,000,000, denied above. Illustrative thresholds from the demo policy treasury-transfer-limits." />
        <div className="mt-8">
          <BankingWalkthrough />
        </div>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Scenario 2" title="Refund tiers: which rule fires?" lead="Move the amount and watch the deciding rule change. Below AED 500 is allowed, AED 500 to 2,500 requires an approver, above AED 2,500 is denied. Illustrative thresholds from the demo policy refund-authority." />
        <div className="mt-8">
          <RefundSlider />
        </div>
        <Note className="mt-6" title="Also in the live refund scenario">
          A retried request with the same idempotency key returns the original result and the support platform is not called twice. An approval that expires cannot be used afterwards. Replaying an approved request with a different amount is rejected and needs a new evaluation.
        </Note>
      </Section>
      <Section>
        <SectionHeading eyebrow="Scenario 3" title="Data egress is stopped at the parameters" lead="Two attempts by a marketing agent to move customer data outside the organization, and how destination rules, Shield detectors and policy combine to deny them." />
        <div className="mt-8">
          <EgressBlock />
        </div>
      </Section>
      <Section dark>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="mk-h2">Run it for real</h2>
            <p className="mk-lead mt-3">The console runs these scenarios through the gateway, the policy engine, the approval service and the simulated downstream systems, and shows the evidence chain as it grows. Demo data is synthetic and labelled.</p>
          </div>
          <TourFooterLinks />
        </div>
      </Section>
    </>
  );
}
