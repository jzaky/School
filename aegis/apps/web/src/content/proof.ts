/**
 * Content of the public Proof page (/site/proof). Edit this file to add or change an entry; the
 * page itself only renders these lists.
 *
 * FIGURES are checked against the repository by `node scripts/proof-check.mjs` in CI: when a test
 * is added or a catalog grows, the build fails until the figure here is updated. Run the script with
 * `--print` to get the live values.
 */

export const FIGURES = {
  /** `it(` cases under packages/core/tests. */
  coreTests: 380,
  /** `it(` cases under packages/db/tests (tenant isolation). */
  dbTests: 22,
  /** Playwright spec files under apps/web/tests/e2e. */
  e2eFiles: 27,
  /** `test(` cases across those spec files. */
  e2eTests: 118,
  /** Shared framework catalogs seeded for every tenant. */
  catalogs: 20,
  /** Controls across those catalogs. */
  controls: 472,
};

export interface ProofRow {
  what: string;
  shows: string;
  /** The command that repeats the check, from the repository root unless stated. */
  repeat: string;
}

/** Tests and recorded runs. Keep each row to what a reader could repeat. */
export const VERIFIED: ProofRow[] = [
  { what: "Core test suite", shows: `${FIGURES.coreTests} automated tests of the product's inner workings (unit and integration tests), covering policy evaluation, the gateway, approvals, execution safety, evidence, Shield, monitoring, audit, SSO (OIDC and SAML), SCIM, agent identity, managed autonomy, uncertainty and calibration, stated-reasons checks, the Attack Simulation Lab and injection response, the model registry, data inventory and regulatory change register, event destinations and their network safety checks, policy conflict analysis and exceptions, deployment readiness and data residency assessment, plans, metering and invoices, the six sales demonstration scenarios, the security regression suite (cross-tenant references, policy tampering, concurrency limits, DNS pinning, injected database failure), metrics, circuit breakers, dead-letter handling and operational alerts, evidence signing and key rotation, shared rate limits, background jobs, connectors, templates and the public checker`, repeat: "pnpm --filter @aegis/core test" },
  { what: "Browser suite", shows: `${FIGURES.e2eTests} tests that drive a real browser through the console and the public site (Playwright, ${FIGURES.e2eFiles} spec files), run against a production build in CI: control, approvals, policies, assurance, audit, Shield, integrations, onboarding, governance, score bands, replay, posture, trading, the gateway outcomes between allow and deny, agent identity and access, managed autonomy, uncertainty, the Decision Inspector, the Attack Simulation Lab, model and data governance, the integration marketplace and event destinations, policy conflicts and exceptions, the Control Center, System Health, themes and keyboard shortcuts, deployment readiness and the Arabic console, billing, support, customer onboarding and the sales demonstration, the public checker and the site`, repeat: "cd apps/web && npx playwright test" },
  { what: "Tenant isolation", shows: `${FIGURES.dbTests} tests that each customer's data is kept apart inside the database (row-level security): one tenant cannot read, write or even count another tenant's rows, and the application's own database role cannot bypass the rules`, repeat: "pnpm --filter @aegis/db test" },
  { what: "Refund journey over HTTP", shows: "12 of 12 checks passed in one run from start to finish: register an agent, give it a tool, submit a refund below and above the limit, approve it, have the downstream system verify its one-time permission slip (execution grant), then read the receipt and the evidence", repeat: "npx tsx scripts/smoke-refund-journey.mts" },
  { what: "Stripe test-mode connector", shows: "Run through the real gateway against a stand-in Stripe server: the same refund is never carried out twice (idempotent), a lost response is settled by checking Stripe's own records (reconciliation), and live keys are refused", repeat: "npx vitest run tests/stripe-connector.test.ts" },
  { what: "Alpaca paper connector", shows: "Run through the real gateway against a stand-in Alpaca server: each order carries the gateway's never-twice key (idempotency key), orders in the approval band wait for a person to release them, a lost response is settled by looking the order up, and live keys and the live host are refused", repeat: "npx vitest run tests/trading.test.ts" },
  { what: "Layout scan", shows: "0 cases of overlapping or cut-off text across 30 pages at five screen widths: 390, 768, 1024, 1280 and 1440 px", repeat: "node tests/overlap-scan.mjs" },
  { what: "Demo seed", shows: "461 historical requests, 75 approvals and 18 denials, all generated through the real gateway with a backdated clock; the evidence chain was verified after seeding", repeat: "pnpm db:seed" },
  { what: "Framework catalogs", shows: `${FIGURES.catalogs} shared catalogs holding ${FIGURES.controls} controls, each an original one-sentence summary with a license note; every reference the public checker makes points to a seeded control`, repeat: "npx vitest run tests/frameworks-checker.test.ts" },
  { what: "Backup and restore drill", shows: "Run on 15 October 2026 against the development database: dumped, restored into a scratch database, row counts matched for 11 core tables, and all 1,202 evidence chains (53,177 events) gave the same verification result on the copy as on the source. One host; not a production recovery drill.", repeat: "MIGRATION_DATABASE_URL=... pnpm --filter @aegis/core drill:restore" },
  { what: "Benchmarks with targets", shows: "Measured on 15 October 2026 in a 4-vCPU development container. Policy evaluation for a 50-rule policy: p95 156 microseconds (target 1 ms, met). Evidence ingestion for one organization: 144 events per second (target 50, met). One gateway decision at a time: p95 220 to 234 ms (target 300 ms, met). Throughput for one organization: 5 to 6.5 decisions per second (target 20, missed; the reason is in docs/PERFORMANCE.md).", repeat: "pnpm --filter @aegis/core bench; AEGIS_URL=http://localhost:4000 npx tsx scripts/perf-gateway.mts 200 10" },
  { what: "Proof page figures", shows: "The counts on this page are compared with the repository on every CI run, and the build fails when they no longer match", repeat: "node scripts/proof-check.mjs" },
];

/** Things AEGIS does not claim. Add a line here before anyone is tempted to claim it. */
export const NOT_CLAIMED: string[] = [
  "No customers, paying or otherwise. Meridian Gulf Bank and every person in the demo are fictional.",
  "No government or enterprise deployment. The production URL serves the demo tenant.",
  "No regulatory certification, accreditation or independent audit of AEGIS. The Audit module matches your records to framework controls; it does not certify anything.",
  "No proof of AI safety. AEGIS limits what an agent may do and records what it did; it does not make a model honest or correct.",
  "No live transaction has been made. The Stripe connector runs in test mode, the Alpaca connector runs on paper accounts, and both refuse live keys.",
  "No institutional partnership with any standards body, regulator, bank or broker.",
];

export interface NotYetRow {
  check: string;
  status: string;
}

/** Checks that have a script or a plan but have not been run. Move a row to VERIFIED when it has. */
export const NOT_YET: NotYetRow[] = [
  { check: "Stripe test-mode run against Stripe's own API", status: "The connector is verified against a stand-in Stripe server. The real test-mode run (scripts/stripe-sandbox-check.mts) needs a customer's test key and has not been made." },
  { check: "Alpaca paper-account run", status: "Verified against a stand-in Alpaca server. The real paper-account run (scripts/alpaca-paper-check.mts) needs a paper key and has not been made." },
  { check: "Independent penetration test", status: "Not commissioned. The threat model and the known gaps are published on the Security page." },
  { check: "Load testing at scale", status: "Measured only in a single development container, one organization at a time. Throughput across organizations, several API replicas and a separate database host have not been measured. See docs/PERFORMANCE.md." },
  { check: "Production deployment of the current build", status: "Not made. Every feature is verified by tests in the repository, none in a deployed environment. Deployment needs the owner's approval." },
  { check: "Employee AI gateway, Shadow AI discovery, software supply-chain scanning, isolated execution", status: "Planned in docs/AEGIS_MASTER_ROADMAP.md (Secure track); not built. Listed as planned on the Billing page, never as included." },
];
