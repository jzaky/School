import type { Metadata } from "next";
import { PageIntro, Prose, Section } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Terms of use", description: "Terms for using the AEGIS public website. Draft for review by counsel." };

export default function TermsPage() {
  return (
    <>
      <PageIntro eyebrow="Legal" title="Terms of use" lead="Draft for review by counsel. Short, plainly worded terms for this website." />
      <Section>
        <Prose>
          <p>
            <strong className="text-(--mk-fg)">Status.</strong> This is a draft that has not been reviewed by legal counsel. It covers the public website only. Use of a deployed AEGIS platform is governed by a separate license agreement.
          </p>
          <p>
            <strong className="text-(--mk-fg)">Information on this site.</strong> Pages describe a pre-release build. Capabilities, thresholds and screens are illustrative and may change. Example amounts and rules are customer-configurable examples, not recommendations. Nothing here is legal, regulatory or compliance advice.
          </p>
          <p>
            <strong className="text-(--mk-fg)">No claims.</strong> We do not claim existing customers, certifications, independent audits, regulatory approval or any level of availability. The Security page lists known gaps.
          </p>
          <p>
            <strong className="text-(--mk-fg)">Demo environment.</strong> Any demo environment you are given access to contains synthetic data only. Do not upload personal data or confidential material to it. Access may be withdrawn at any time.
          </p>
          <p>
            <strong className="text-(--mk-fg)">Acceptable use.</strong> Do not attempt to probe, scan or disrupt this website or any demo environment without written permission. Report security findings through the contact form; we will acknowledge them.
          </p>
          <p>
            <strong className="text-(--mk-fg)">Content.</strong> Text and diagrams on this site may be quoted with attribution. The AEGIS name and mark may not be used to imply endorsement.
          </p>
          <p>
            <strong className="text-(--mk-fg)">Liability.</strong> The site is provided as is. To the extent permitted by law we accept no liability for reliance on its content. A reviewed version of these terms, including governing law, will replace this draft before commercial use.
          </p>
        </Prose>
      </Section>
    </>
  );
}
