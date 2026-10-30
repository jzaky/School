# Framework catalogs: what ships and how to add one

The Audit module assesses an organization's documents and records against shared catalogs of
controls. Every catalog entry is an original one-sentence summary written by AEGIS with the
source's identifier; no standard, law or regulation text is reproduced, and each catalog carries a
license note saying so. Mapping an AEGIS record to a control is evidence for the organization's own
assessment, not a certification.

## Catalogs that ship

| Key | Catalog | Entries | Form |
| --- | --- | --- | --- |
| iso-42001 | ISO/IEC 42001:2023 AI management system | 65 | TypeScript |
| iso-27001-2022 | ISO/IEC 27001:2022 Annex A | 93 | TypeScript |
| nist-ai-rmf-1.0 | NIST AI Risk Management Framework 1.0 | 72 | TypeScript |
| eu-ai-act | EU AI Act (Regulation (EU) 2024/1689) | 28 articles | TypeScript |
| gdpr | GDPR (Regulation (EU) 2016/679) | 25 articles | TypeScript |
| uae-pdpl | UAE Personal Data Protection Law | 17 principles | TypeScript |
| desc-isr | Dubai DESC Information Security Regulation v3 | 15 domains | TypeScript |
| iso-23894 | ISO/IEC 23894:2023 AI risk management | 14 | TypeScript |
| iso-27701 | ISO/IEC 27701:2019 Privacy information management | 15 | TypeScript |
| iso-27017 | ISO/IEC 27017:2015 Cloud security controls | 10 | TypeScript |
| iso-27018 | ISO/IEC 27018:2019 PII in public clouds | 11 | TypeScript |
| iso-42005 | ISO/IEC 42005:2025 AI system impact assessment | 10 | TypeScript |
| iso-38507 | ISO/IEC 38507:2022 Governance implications of AI | 8 | TypeScript |
| owasp-llm-top10 | OWASP Top 10 for LLM Applications (2025) | 10 | JSON |
| nist-csf-2 | NIST Cybersecurity Framework 2.0 (categories) | 22 | JSON |
| difc-dpl-2020 | DIFC Data Protection Law 2020 (principles) | 15 | JSON |
| uae-ia | UAE Information Assurance Regulation (control families) | 15 | JSON |
| sg-model-ai-governance | Singapore Model AI Governance Framework | 10 | JSON |
| sdaia-ai-ethics | SDAIA AI Ethics Principles (Saudi Arabia) | 7 | JSON |
| soc2-tsc | SOC 2 Trust Services Criteria (category level) | 13 | JSON |
| pci-dss-4 | PCI DSS v4.0 (requirement level) | 12 | JSON |

Where a source's own numbering is copyrighted, uncertain or not meant for citation (DESC ISR, the
UAE and DIFC data protection laws, SOC 2, the Singapore framework, SDAIA), the catalog uses AEGIS
identifiers at domain or principle level and the license note says so.

Tenants can also create their own custom frameworks in the console (Standards, Custom framework)
and import controls from CSV. Those belong to the tenant and are not part of the shared catalog.

## Adding a shared catalog: three steps, no code

1. Scaffold a file:

   ```
   node scripts/new-catalog.mjs mas-feat "MAS FEAT principles" "Monetary Authority of Singapore"
   ```

   This writes `packages/core/src/seed/frameworks/catalogs/mas-feat.json` with the fields below
   and one example control.

2. Fill in the controls. Each entry has:

   | Field | Meaning |
   | --- | --- |
   | code | The source's identifier (for example "Art. 14", "A.5.15", "GV.PO") or an AEGIS identifier when the source's numbering should not be cited |
   | title | A short original title |
   | summary | One original sentence (20 to 1000 characters) describing what the control asks for. Never the source's text |
   | category | The section, chapter or domain the control belongs to |
   | keywords | Words the assessment engine searches documents for (at least one) |
   | automatedEvidenceType | Optional: which AEGIS records can confirm the control automatically. One of approval_workflow, evidence_ledger, access_control, incident_management, policy_versioning, monitoring, agent_inventory, data_protection, integration_security, security_events |

   Write a `licenseNote` that states the source, that summaries are original, and that mapping is
   not a conformance statement. Keep the `key` lowercase with digits, dots and hyphens.

3. Check and seed:

   ```
   pnpm --filter @aegis/core exec vitest run tests/frameworks-checker.test.ts
   node scripts/seed-frameworks.mjs
   ```

   The test validates every file (unique keys and codes, summaries of sensible length, keywords
   present, valid evidence types, no em dashes) and the seed upserts the catalogs for every tenant.
   The Proof page figures are checked in CI (`node scripts/proof-check.mjs --print` gives the new
   counts to paste into `apps/web/src/content/proof.ts`).

Optionally, add the catalog to the public checker (`packages/core/src/audit/checker.ts`): list it in
CHECKER_FRAMEWORKS and reference its codes from the questions it answers. The test fails if a
reference does not resolve to a seeded control.

## What a catalog is not

A catalog is a map for an assessment. It does not make an organization compliant, it is not legal
advice, and AEGIS does not certify anything against it. The Standards page in the console shows each
catalog's license note next to it.
