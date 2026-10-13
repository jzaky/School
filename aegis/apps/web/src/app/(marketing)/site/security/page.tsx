import type { Metadata } from "next";
import Link from "next/link";
import { ClosingCta, Note, PageIntro, Prose, Section, SectionHeading, Table } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Security", description: "AEGIS security architecture: identity, authorization path, data protection, tenant isolation, evidence integrity, network and runtime controls, private deployment options and the known gaps." };

const BLOCKS: { id: string; title: string; items: string[] }[] = [
  {
    id: "identity",
    title: "Identity",
    items: [
      "Console users: argon2id password hashes, lockout after 8 failures, server-side sessions (12 hour absolute, 2 hour idle) in HttpOnly Secure SameSite=Lax cookies, TOTP MFA (RFC 6238).",
      "Per-organization OpenID Connect with PKCE and just-in-time provisioning limited to allowed email domains. SAML is not implemented.",
      "Agents and integrations: API keys aegis_ak_<prefix>_<secret>, SHA-256 hashed at rest, shown once, scoped to one subject, revocable, revoked automatically when an agent is revoked.",
      "Roles: 8 system roles over 22 explicit permissions; custom roles cannot hold the wildcard. Four-eyes rule on policy activation (a second person must switch it on). Separation of duties on approvals (the people who own an agent cannot approve its requests).",
    ],
  },
  {
    id: "authorization",
    title: "Authorization path",
    items: [
      "Registry checks (agent active, tool granted and enabled, integration active, parameter schema, resource permission, classification, destination allowlist, gateway pause), then Shield inspection, then deterministic policy evaluation with default deny (the same request always gets the same answer, and when no rule matches the answer is no).",
      "Decisions, approvals and receipts are written in the same transaction as the evidence event; an evidence failure rolls back the decision.",
      "Execution grants (a one-time permission slip the downstream system checks before acting) are single use, five minutes, bound to the SHA-256 of tool, action and parameters; downstream systems verify them.",
    ],
  },
  {
    id: "data",
    title: "Data protection",
    items: [
      "Secrets at rest: AES-256-GCM with the master key, ciphertext bound to the row (additional authenticated data).",
      "Logs: pino redaction of credentials and tool parameters; evidence payloads carry hashes and summaries; traces truncate long values.",
      "Sensitive data in tool parameters: detector registry with mask, redact, block and approval actions (Shield).",
      "Documents uploaded to Audit never leave the deployment. No external AI calls exist in this version.",
    ],
  },
  {
    id: "isolation",
    title: "Tenant isolation",
    items: ["Row-level security on every tenant table (each customer's data is kept apart inside the database), application role NOBYPASSRLS and non-owner, transaction-local app.current_org, three SECURITY DEFINER functions for the only cross-tenant lookups (API key by hash, memberships by user, invitation by hash).", "Covered by the isolation test suite (11 tests) that proves two organizations cannot see each other through reads, writes or raw SQL."],
  },
  {
    id: "integrity",
    title: "Integrity",
    items: ["Per-organization SHA-256 hash chain over canonical JSON (a record that cannot be edited without it showing), UPDATE and DELETE rejected by trigger, Ed25519 checkpoints (signed markers that show whether the record has been edited since) with the key outside the database, verification API and exports with the public key.", "Tamper-evident, not immutable: an attacker with the owner role and the signing key could rewrite history; externally stored checkpoints make that detectable."],
  },
  {
    id: "network",
    title: "Network and runtime",
    items: ["Rate limits per key and per IP, body limits, Helmet headers, CORS allowlist, HMAC-signed webhooks with a replay window, non-root containers, Kubernetes network policy template for egress."],
  },
];

const GAPS: string[][] = [
  ["No SAML", "OpenID Connect only. Organizations that require SAML need an OIDC bridge from their identity provider."],
  ["Keys in environment variables", "The master key, session secret and evidence signing key are read from the environment, not from a KMS or HSM."],
  ["Manual master key rotation", "Rotating AEGIS_MASTER_KEY requires re-encrypting stored secrets; this is documented, not automated."],
  ["Egress enforcement depends on the platform", "For real downstream systems, stopping agents from bypassing the gateway at the network level depends on the customer network policy. The shipped Kubernetes manifest is a template."],
  ["Heuristic injection detection", "Prompt-injection signals are pattern based with confidences. They will miss novel phrasing. Authorization does not depend on them."],
  ["No independent penetration test", "No third party has tested this build. No certification or independent audit exists."],
  ["Lockout is basic", "Account lockout counts failures per account; adaptive or risk-based controls are not implemented."],
];

export default function SecurityPage() {
  return (
    <>
      <PageIntro eyebrow="Security" title="Fail closed, least privilege, every action attributable" lead="This page sets out how AEGIS protects your data and your systems, and where it still falls short. If anything inside AEGIS fails, nothing happens in your systems, and every action can be traced to who or what asked for it. The controls are listed in the same words as the internal security architecture document, followed by the gaps we know about." />
      <Section>
        <div className="grid gap-x-10 gap-y-12 lg:grid-cols-2">
          {BLOCKS.map((b) => (
            <section key={b.id} id={b.id} aria-labelledby={`${b.id}-h`}>
              <h2 id={`${b.id}-h`} className="mk-h3">
                {b.title}
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-(--mk-muted)">
                {b.items.map((it) => (
                  <li key={it} className="flex gap-2.5">
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-(--mk-accent)" aria-hidden />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Section>
      <Section id="known-gaps" className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Honesty" title="Known gaps" lead="These are the things AEGIS does not do yet, or does only in a basic way. Also recorded in the threat model. We would rather you read these here than discover them in a review." />
        <div className="mt-8">
          <Table head={["Gap", "Detail"]} rows={GAPS} caption="Known security gaps in the current build" />
        </div>
      </Section>
      <Section id="deployment">
        <SectionHeading eyebrow="Private deployment" title="Everything runs inside your boundary" lead="You run AEGIS on your own servers, inside your own security boundary, with the pieces listed here. Four processes: api, web, worker and a one-shot migrate job that applies migrations and the row-level security script with owner credentials." />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="mk-card">
            <h3 className="mk-h3">Docker Compose</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">Single host: PostgreSQL 16, Redis, api, web, worker and the migrate job from one compose file. An optional observability file adds an OTLP collector.</p>
          </div>
          <div className="mk-card">
            <h3 className="mk-h3">Kubernetes</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">Namespace, config map, secret template, migrate job, api, web and worker deployments with non-root security contexts, services, TLS ingress and a network policy restricting API egress to the database, Redis and DNS. Add explicit egress rules for real downstream systems.</p>
          </div>
          <div className="mk-card">
            <h3 className="mk-h3">No outbound calls to AI providers</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">No component calls an external model or AI service. Telemetry leaves the cluster only when an OTLP endpoint is configured. Email is disabled unless a provider key is set; the console provider logs instead.</p>
          </div>
        </div>
        <Prose className="mt-8">
          <p>Two database URLs are required: one for the non-owner application role at runtime and one for the owner role used only by migrations. If the application role owned the tables, row-level security would not apply to it. Required secrets are the master key (AES-256-GCM for credentials, SSO and MFA secrets), the session secret and the Ed25519 evidence signing key, all generated with the shipped key generator.</p>
        </Prose>
      </Section>
      <Section id="data-handling" className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Data handling" title="What AEGIS stores and what it does not" />
        <Prose className="mt-6">
          <p>AEGIS stores the registry (agents, tools, resources, policies), action requests with their parameters after schema validation, decisions with their explanation, approvals and responses, grants, receipts, security events, incidents, monitoring alerts, uploaded documents for assessment, and the evidence chain. Evidence payloads carry hashes and summaries rather than full payloads; long values are truncated in traces. Logs redact credentials and tool parameters.</p>
          <p>Downstream credentials are encrypted at rest with the master key and are only decrypted inside the gateway process at execution time. Agents never receive them.</p>
          <p>
            This public site stores one record per contact or demo request so a person can reply by email. Nothing else is collected; see the{" "}
            <Link href="/site/privacy" className="underline underline-offset-2">
              privacy notice
            </Link>
            .
          </p>
        </Prose>
        <Note className="mt-6" title="On frameworks">
          Control catalogs for ISO/IEC 42001, ISO/IEC 27001 Annex A and NIST AI RMF are referenced so that evidence can be mapped to control identifiers. Referencing a framework is not conformance with it, and AEGIS holds no certification.
        </Note>
      </Section>
      <ClosingCta title="Security review?" body="Ask for the threat model, the fail-closed test list and a walkthrough of the isolation suite. We will be specific about what is built, simulated and missing." />
    </>
  );
}
