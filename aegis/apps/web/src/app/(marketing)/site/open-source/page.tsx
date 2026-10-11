import type { Metadata } from "next";
import { ClosingCta, Note, PageIntro, Prose, Section, SectionHeading, Table } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Open source and licensing", description: "The open-source projects AEGIS builds on, adapts or defers, and how licensing is handled: MIT, Apache-2.0, BSD and ISC only; nothing copied from AGPL or GPL repositories." };

const STACK: string[][] = [
  ["Policy evaluation", "Original TypeScript deterministic evaluator; OPA adapter optional (experimental)", "Built"],
  ["Relationship authorization", "Tables plus a small resolver; OpenFGA considered for later", "Built (tables)"],
  ["Durable jobs", "PostgreSQL job table plus worker (SKIP LOCKED, idempotency keys); Temporal deferred", "Built"],
  ["Observability", "OpenTelemetry instrumentation; SigNoz as an optional backend", "Built (instrumentation)"],
  ["PII detection", "Original detector registry following the Presidio recognizer and anonymizer pattern; Presidio optional", "Built"],
  ["Prompt-injection signals", "Original heuristics plus an evaluation corpus run in CI", "Built"],
  ["Document parsing", "pdf-parse, mammoth, native text; Docling considered for later", "Built"],
  ["Retrieval", "BM25 implemented from the public formula over chunks in PostgreSQL; Qdrant considered for later", "Built"],
  ["Model routing", "Not in scope; an llm_gateway integration type is reserved for LiteLLM", "Deferred"],
  ["Agent workflow", "Customer side (LangGraph or any framework); TypeScript SDK provided", "SDK built"],
];

const PROJECTS: string[][] = [
  ["Open Policy Agent", "Apache-2.0", "Adapt now, adopt as optional evaluator", "Versioned policy documents, input document, structured decision with explanation, policy unit tests; adapter against the documented REST API"],
  ["OpenFGA", "Apache-2.0", "Adapt, defer adoption", "Shallow relationship graph modelled as tables; resolver interface accepts an OpenFGA implementation later"],
  ["Cerbos", "Apache-2.0", "Reject as runtime, borrow the authoring shape", "Readable resource policy shape informed the JSON policy schema; no code"],
  ["LiteLLM", "MIT (core)", "Defer", "AEGIS governs tool calls, not model traffic; integration type reserved"],
  ["LangGraph", "MIT", "Adapt", "SDK lets any agent authorize before a tool runs; approval wait state lives in AEGIS"],
  ["Temporal", "MIT", "Defer, adapt the durability properties", "Durable approval expiry and retries on a PostgreSQL job table instead of a second scheduler"],
  ["Langfuse", "MIT (except ee)", "Defer, keep an export seam", "Evidence events carry correlationId and traceId for joining to traces"],
  ["OpenTelemetry", "Apache-2.0", "Adopt", "Traces and metrics for api, gateway and worker; export only when an endpoint is configured"],
  ["SigNoz", "MIT (except ee)", "Adopt as optional backend", "Documented in the observability compose file"],
  ["Microsoft Presidio", "MIT", "Adapt now, optional adopt later", "Recognizer and anonymizer pattern reimplemented in TypeScript; provider interface reserved"],
  ["Guardrails AI", "Apache-2.0", "Reject for v1", "Parameter validation happens with JSON Schema at the gateway"],
  ["Giskard", "Apache-2.0", "Adapt the test-suite idea, defer the tool", "Own security evaluation corpus runs against the gateway in CI"],
  ["Docling", "MIT", "Defer, parser interface", "pdf-parse and mammoth in process; interface accepts Docling later"],
  ["Qdrant", "Apache-2.0", "Defer", "BM25 lexical retrieval in PostgreSQL; interface accepts a vector store when an embeddings provider is authorised"],
];

export default function OpenSourcePage() {
  return (
    <>
      <PageIntro eyebrow="Open source and licensing" title="What AEGIS builds on" lead="Every dependency is MIT, Apache-2.0, BSD or ISC. Patterns were studied from public documentation; no source code was copied from any third-party repository, and nothing was taken from AGPL or GPL projects." />
      <Section>
        <SectionHeading title="Guiding constraints" />
        <ol className="mt-6 grid gap-3 text-sm md:grid-cols-2">
          {["One deterministic authorization path. Two policy engines in the request path would double the failure surface and make deny-on-failure harder to prove.", "The first version is a TypeScript modular monolith. Anything forcing a Python or JVM sidecar into the critical path is deferred unless there is no credible alternative.", "Every dependency must be MIT, Apache-2.0, BSD or ISC. Projects with enterprise or commercial folders are acceptable only if nothing is imported from those folders.", "Nothing from AGPL or GPL repositories is copied. Patterns may be studied from public documentation."].map((t, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-(--mk-line) p-3">
              <span className="font-mono text-xs text-(--mk-accent)">{i + 1}</span>
              <span className="text-(--mk-muted)">{t}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading title="The chosen stack" lead="Summary of the research record kept in the repository." />
        <div className="mt-8">
          <Table head={["Concern", "Choice", "Status"]} rows={STACK} caption="Chosen stack by concern" />
        </div>
      </Section>
      <Section>
        <SectionHeading title="Projects evaluated" lead="Adopt means run or depend on it. Adapt means reimplement public patterns in our own code. Defer means a good fit later. Reject means not used." />
        <div className="mt-8">
          <Table head={["Project", "License", "Decision", "Why"]} rows={PROJECTS} caption="Open-source projects evaluated for AEGIS" />
        </div>
        <Prose className="mt-8">
          <p>Algorithms implemented from public specifications: Luhn checksum, IBAN mod-97 (ISO 7064), RFC 6238 TOTP, RFC 8785-style canonical JSON, BM25 (Robertson and Zaragoza), PKCE (RFC 7636). Patterns studied from documentation only: Open Policy Agent (decision input and explanation model), Cerbos (readable resource policy shape), Microsoft Presidio (recognizer and anonymizer registry), XACML (deny-overrides combining).</p>
        </Prose>
        <Note className="mt-6" title="Third-party inventory">
          The repository ships a generated inventory of every production dependency with its license (428 packages after deduplication at the last generation). Direct dependencies include Prisma (Apache-2.0), Fastify (MIT), Next.js and React (MIT), Radix UI (MIT), Zod (MIT), argon2 (MIT), jose (MIT), pino (MIT), OpenTelemetry (Apache-2.0), pdfkit (MIT), pdf-parse (MIT) and mammoth (BSD-2-Clause). Items flagged for legal review in that inventory: LGPL prebuilt libvips binaries pulled in by the optional image library used by Next.js (removable by disabling image optimization), and two legacy BSD identifiers without a clause count. The inventory is provided to customers with the deployment package.
        </Note>
      </Section>
      <ClosingCta title="Need the full inventory?" body="Procurement and legal teams can request the generated third-party inventory and the research record with licensing decisions." />
    </>
  );
}
