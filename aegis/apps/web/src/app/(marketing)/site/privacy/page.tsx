import type { Metadata } from "next";
import { PageIntro, Prose, Section } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Privacy notice", description: "How the AEGIS public site handles the information you send through its forms. Draft for review by counsel." };

export default function PrivacyPage() {
  return (
    <>
      <PageIntro eyebrow="Legal" title="Privacy notice" lead="Draft for review by counsel. Plain wording about what this website collects." />
      <Section>
        <Prose>
          <p>
            <strong className="text-(--mk-fg)">Status.</strong> This notice is a draft and has not been reviewed by legal counsel. It describes the current behaviour of this website only; it does not describe a deployed AEGIS platform, which is operated by the customer inside their own environment.
          </p>
          <p>
            <strong className="text-(--mk-fg)">What we collect.</strong> When you submit the contact, demo or quote form we store the fields you entered: name, work email, organization, role, area of interest, your message and, for demo requests, preferred dates and deployment preference. We also store the page the form was on and the time of submission. We do not store your IP address in that record; the address is used in memory only to limit the number of submissions per hour.
          </p>
          <p>
            <strong className="text-(--mk-fg)">What we do with it.</strong> A person reads the submission and replies by email. We do not send automated emails, we do not add you to a marketing list and we do not share the information with third parties. Records are kept until the inquiry is closed or for twelve months, whichever is earlier, and then deleted.
          </p>
          <p>
            <strong className="text-(--mk-fg)">Cookies and analytics.</strong> The public pages set no cookies and run no analytics or tracking scripts. The console sign-in sets a session cookie that is described in the platform documentation.
          </p>
          <p>
            <strong className="text-(--mk-fg)">Your choices.</strong> Email us using the contact form to ask what we hold about you, to correct it or to have it deleted. We will confirm by email.
          </p>
          <p>
            <strong className="text-(--mk-fg)">Changes.</strong> This notice will be replaced by a reviewed version before any commercial use of the site. The date of the last change will appear here.
          </p>
        </Prose>
      </Section>
    </>
  );
}
