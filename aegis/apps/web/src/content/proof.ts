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
  coreTests: 204,
  /** `it(` cases under packages/db/tests (tenant isolation). */
  dbTests: 11,
  /** Playwright spec files under apps/web/tests/e2e. */
  e2eFiles: 15,
  /** `test(` cases across those spec files. */
  e2eTests: 76,
  /** Shared framework catalogs seeded for every tenant. */
  catalogs: 13,
  /** Controls across those catalogs. */
  controls: 383,
};

export interface ProofRow {
  what: string;
  shows: string;
  /** The command that repeats the check, from the repository root unless stated. */
  repeat: string;
}

/** Tests and recorded runs. Keep each row to what a reader could repeat. */
export const VERIFIED: ProofRow[] = [
  { what: "Core test suite", shows: `${FIGURES.coreTests} unit and integration tests across policy evaluation, the gateway, approvals, execution safety, evidence, Shield, monitoring, audit, SSO, jobs, connectors, templates and the public checker`, repeat: "pnpm --filter @aegis/core test" },
  { what: "Browser suite", shows: `${FIGURES.e2eTests} Playwright tests in ${FIGURES.e2eFiles} spec files driving the console and the public site through a production build in CI: control, approvals, policies, assurance, audit, Shield, integrations, onboarding, governance, score bands, replay, posture, trading, the public checker and the site`, repeat: "cd apps/web && npx playwright test" },
  { what: "Tenant isolation", shows: `${FIGURES.dbTests} row-level security tests: a tenant cannot read, write or count another tenant's rows, and the app role cannot bypass the policies`, repeat: "pnpm --filter @aegis/db test" },
  { what: "Refund journey over HTTP", shows: "12 of 12 checks: register an agent, grant a tool, submit a refund below and above the limit, approve, verify the execution grant downstream, read the receipt and the evidence", repeat: "npx tsx scripts/smoke-refund-journey.mts" },
  { what: "Stripe test-mode connector", shows: "Executed through the real gateway against a fake Stripe server: idempotent refunds, lost responses reconciled from Stripe's own records, live keys refused", repeat: "npx vitest run tests/stripe-connector.test.ts" },
  { what: "Alpaca paper connector", shows: "Executed through the real gateway against a fake Alpaca server: orders keyed by the gateway idempotency key, approval-band orders released by a person, lost responses reconciled by order lookup, live keys and the live host refused", repeat: "npx vitest run tests/trading.test.ts" },
  { what: "Layout scan", shows: "0 overlapping or clipped text findings across 30 pages at 390, 768, 1024, 1280 and 1440 px", repeat: "node tests/overlap-scan.mjs" },
  { what: "Demo seed", shows: "461 historical requests, 75 approvals and 18 denials generated through the real gateway with a backdated clock; evidence chain verified after seeding", repeat: "pnpm db:seed" },
  { what: "Framework catalogs", shows: `${FIGURES.catalogs} shared catalogs, ${FIGURES.controls} controls, each an original one-sentence summary with a license note; every public checker reference resolves to a seeded control`, repeat: "npx vitest run tests/frameworks-checker.test.ts" },
  { what: "Proof page figures", shows: "The counts on this page are compared with the repository on every CI run and the build fails when they drift", repeat: "node scripts/proof-check.mjs" },
];

/** Things AEGIS does not claim. Add a line here before anyone is tempted to claim it. */
export const NOT_CLAIMED: string[] = [
  "No customers, paying or otherwise. Meridian Gulf Bank and every person in the demo are fictional.",
  "No government or enterprise deployment. The production URL serves the demo tenant.",
  "No regulatory certification, accreditation or independent audit of AEGIS. The Audit module maps records to framework controls; it does not certify anything.",
  "No proof of AI safety. AEGIS constrains what an agent may do and records what it did; it does not make a model honest or correct.",
  "No live transaction has been made. The Stripe connector runs in test mode and the Alpaca connector on paper accounts, and both refuse live keys.",
  "No institutional partnership with any standards body, regulator, bank or broker.",
];

export interface NotYetRow {
  check: string;
  status: string;
}

/** Checks that have a script or a plan but have not been run. Move a row to VERIFIED when it has. */
export const NOT_YET: NotYetRow[] = [
  { check: "Stripe test-mode run against Stripe's own API", status: "The connector is verified against a fake Stripe server. The real test-mode run (scripts/stripe-sandbox-check.mts) needs a customer's test key and has not been made." },
  { check: "Alpaca paper-account run", status: "Verified against a fake Alpaca server. The real paper run (scripts/alpaca-paper-check.mts) needs a paper key and has not been made." },
  { check: "Independent penetration test", status: "Not commissioned. The threat model and known gaps are published on the Security page." },
  { check: "Load testing at scale", status: "Measured only on a single developer machine; see docs/PERFORMANCE.md for the numbers and their limits." },
];
