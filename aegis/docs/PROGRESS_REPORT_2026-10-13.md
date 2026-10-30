# AEGIS progress report, 13 October 2026

Branch `claude/aegis-ai-governance-bgmcnk`, pull request #1 on jzaky/School. Everything below is
committed and pushed unless marked otherwise. Figures are from the last runs on this branch; the
Proof page check in CI keeps the test and catalog counts honest.

## 1. What AEGIS is today

A multi-tenant governance product for AI agents that take actions. An agent asks the Action Gateway
before it touches a real system; the gateway checks the agent, its tools, the parameters and the
data, evaluates versioned policies, routes risky actions to a named approver, executes once with a
one-time permission the downstream system verifies, and records every step in a per-organization
record that cannot be edited without it showing. Four modules: Control (agents, policies, gateway,
approvals), Assurance (evidence ledger, monitoring, reports), Shield (sensitive data, tool security,
incidents), Audit (framework catalogs, document assessment, remediation, reports).

Stack: pnpm monorepo. PostgreSQL with row-level security (app role cannot bypass), Prisma 6,
Fastify API, Next.js 15 console and public site, worker for jobs and monitoring, Redis. Branded
"AEGIS by Nexus AI Assurance".

## 2. Delivered this session, in order

### 2.1 Branding, deployment steps, layout
- Rebranded site and console to "AEGIS by Nexus AI Assurance".
- `docs/DEPLOY_STEP_BY_STEP.md`: plain steps from a bare Ubuntu server to a running deployment
  (DNS records, ports, Docker, environment file, first login).
- Layout pass: every overlapping or clipped text on the site and console fixed; a scan script
  (`apps/web/tests/overlap-scan.mjs`) reports 0 findings over 30 pages at five widths.

### 2.2 Continuous governance (option on any tier)
- Organization setting with two modes: assisted (alerts notify people) and continuous (AEGIS
  responds on its own). Per monitoring rule you choose the response: suspend the agent, pause the
  gateway, disable the integration, or notify only.
- Every automatic response is recorded as evidence, notifies administrators and can be reversed by
  a person. Core 4 tests, browser 2 tests. `docs/CONTINUOUS_GOVERNANCE.md`.

### 2.3 DNRS comparison
- `docs/COMPARISON_DNRS.md`: every public page of dnrs.ai read and compared with AEGIS, a
  side-by-side table, eight ideas worth building on our own terms, what not to take, and the order of
  work you chose. Items 1 to 5 of that order are now done (below).

### 2.4 CI on a production build, two production defects fixed
- The browser suite in CI now runs against a production build of the console instead of the dev
  server. That exposed two real defects: platform administration used the database owner
  credential (now uses the app role with per-tenant counts), and the report period navigation was
  flaky (now plain links).

### 2.5 Item 1: score-band policy template
- Guided template that routes the score your own fraud or risk model produces (0 to 1 or 0 to 100,
  sent in the request) into clear, review, hold and block bands, with approvals, holds, escalation
  and missing-score handling generated for you. New policy dialog option, a Score bands tab with
  live sample outcomes, a seeded example. Core 7 tests, browser 2 tests.

### 2.6 Item 2: replay calibration
- Before activating a draft policy, replay the last 7, 30 or 90 days of real requests against it:
  outcomes before and after, how many change, approvals per day, and each changed request with the
  rule that decided it. Replay tab per version, and a panel under both guided forms that uses
  unsaved settings. Nothing is recorded. Core 5 tests, browser 1 test.

### 2.7 Item 3: autonomy posture and boundary sentence
- Every agent shows a posture (Suspended, Restricted, Supervised, Autonomous) derived from its
  state, tool grants and active policies, with one explanatory sentence, on the Agents list and
  agent page.
- Every approval says how far the request sat from the limit, in the policy's own units: "AED 900 is
  AED 400 above the automatic limit of AED 500 and AED 1,600 below the ceiling of AED 2,500." Exact
  wording for the refund, score-band and trading templates; derived from the decision trace for any
  other policy. Core 6 tests, browser 2 tests.

### 2.8 Item 4: AEGIS Trading
- A guided trading mandate: instrument allowlist, allowed sides and order types, units per order,
  order value bands (automatic, approval, refused), market hours, duplicate block, daily loss cap,
  daily request cap. Mandate tab, live sample orders, replay.
- A simulated brokerage for the demo, a Portfolio Trading Agent with months of history, a demo
  scenario (six orders), and an Alpaca paper-trading connector that refuses live keys and the live
  host, keys orders by the gateway's idempotency key so a replay can never place twice, reconciles
  by order lookup and tests the paper account. Orders read in plain words on approvals.
- `scripts/alpaca-paper-check.mts` runs the journey against a real paper account once you give a
  paper key. Not run yet. Core 13 tests, browser 4 tests. `docs/TRADING.md`, `docs/CONNECTORS.md`.

### 2.9 Item 5: framework catalogs, free checker, Proof page
- Ten new shared catalogs beside ISO/IEC 42001, ISO/IEC 27001 and NIST AI RMF: EU AI Act (28
  articles), GDPR (25), UAE PDPL (17 principles, article numbers deliberately not cited), Dubai DESC
  ISR v3 (15 domains under AEGIS identifiers), ISO/IEC 23894, 27701, 27017, 27018, 42005, 38507.
  Since then seven more as JSON drop-ins (OWASP LLM Top 10, NIST CSF 2.0, DIFC data protection, Singapore model AI governance, SDAIA AI ethics, SOC 2 criteria, PCI DSS v4): 20 catalogs, 472 controls, every entry an original one-sentence summary with a license note and
  automated-evidence hooks where AEGIS records apply.
- Free public checker at `/site/checker`: fourteen questions scored in the visitor's browser,
  coverage per framework with the open control references, a copyable summary, nothing stored or
  sent.
- Proof page at `/site/proof`: what is verified with the command to repeat it, what AEGIS does not
  claim, what has not been run. Content lives in `apps/web/src/content/proof.ts`; a CI step
  (`scripts/proof-check.mjs`) fails the build when its figures drift from the repository. Core 3
  tests, browser 2 tests.

### 2.10 Defects found by CI today and fixed
- PDF parsing failed intermittently ("bad XRef entry"): pdf.js read a Buffer's whole memory pool
  rather than the Buffer's own window. Uploads under 4 KB were exposed in production. Fixed with an
  exact-size copy; regression test parses twelve generated PDFs.
- Replay diverged on the CI runner: the 24-hour request and refusal counters had no upper time
  bound, so later refusals counted against earlier requests. Bounded at the request's own time;
  regression test fails without the fix and passes with it.
- A browser test assumed the first pending approval is a money request; trading orders expire
  sooner and sort first. The test now picks a money row.

### 2.11 In progress now: plain-language pass
- Five parallel rewrites against one style guide: home and tour; products, pilot, pricing, contact,
  checker, proof; architecture, security, open source (plain openings, jargon glossed, depth kept);
  console pages; console dialogs and forms. The technical pages are committed. The rest is being
  verified (typecheck, lint, em-dash rule, browser suites, layout scan) before commit.

## 3. Test record

| Suite | Count | Command |
| --- | --- | --- |
| Core unit and integration | 205 | `pnpm --filter @aegis/core test` |
| Tenant isolation | 11 | `pnpm --filter @aegis/db test` |
| Browser (Playwright) | 76 in 15 spec files | `cd apps/web && npx playwright test` |
| Refund journey over HTTP | 12 of 12 | `npx tsx scripts/smoke-refund-journey.mts` |
| Layout scan | 0 findings, 30 pages, 5 widths | `node tests/overlap-scan.mjs` |
| Catalogs | 20 catalogs, 472 controls | `npx vitest run tests/frameworks-checker.test.ts` |
| Proof figures | match the repository | `node scripts/proof-check.mjs` |

Known flake: `tests/jobs.test.ts` fails when other processes hit the same database at the same
time; it passes alone and in CI.

## 4. What only you can do

1. Alpaca paper key (`KEYID:SECRET`, key id starting with PK): I run the real paper journey.
2. Stripe test-mode key: I run the real test-mode refund journey.
3. Deploy today's work to the production URL (`docs/DEPLOY_STEP_BY_STEP.md`).
4. Decide on a penetration test budget; the threat model and known gaps are on the Security page.

## 5. Honest position against DNRS

Ahead: an installable product that enforces limits; approvals with separation of duties and
expiry; execution safety (single grant, idempotency, reconciliation); signed evidence; tenant
isolation; data protection on parameters and destinations; continuous governance with reversible
responses; 20 catalogs to their 13 crosswalks; a free self-serve checker; a Proof page that says
what has and has not been run.

Behind: a live paper-trading pilot with public results (one key away); research publications and
domain demos on public datasets (publishing is mostly free: arXiv, SSRN, Zenodo); a sales story and
vocabulary for non-technical buyers (the plain-language pass is closing this); customers and a
track record, which nothing replaces.

## 6. Not claimed, anywhere

No customers, no government or enterprise deployment, no certification or independent audit, no
proof of AI safety, no live transaction, no institutional partnership. The Proof page states each
of these.
