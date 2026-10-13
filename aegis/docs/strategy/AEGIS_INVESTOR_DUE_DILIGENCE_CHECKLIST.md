# AEGIS investor due-diligence checklist

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13.

**Status values:**
- **Available:** exists in this repository.
- **Partial:** exists but incomplete.
- **Missing:** must be created.
- **Unknown:** the repository cannot tell. The founder must confirm.

Nothing here invents a document that does not exist.

## Company

| Item | Status | Location or action |
|---|---|---|
| Trade licence and certificate of formation for Nexus AI Assurance FZCO | Unknown | Founder to provide |
| Memorandum and articles of association | Unknown | Founder to provide |
| Share register and capitalization table | Unknown | Founder to provide. Include any promised equity. |
| Board or shareholder resolutions, including founder compensation | Missing | Counsel to draft |
| Holding structure decision for the investment | Missing | Counsel's advice |
| Corporate tax and VAT registration status | Unknown | Accountant to confirm |
| Financial statements and bank statements | Unknown | Accountant and founder. Do not invent history. |
| Existing contracts (including the DNRS NDA, advisers, contractors) | Unknown | Founder to collect |
| Insurance policies | Missing | Broker |

## Product

| Item | Status | Location or action |
|---|---|---|
| Architecture | Available | `docs/ARCHITECTURE.md`, `docs/adr/` |
| Current capabilities, implemented versus simulated | Available | `docs/IMPLEMENTATION_REPORT.md`, `docs/AEGIS_FULL_PLATFORM_AUDIT.md`, `AEGIS_MASTER_BUSINESS_PLAN.md` section 3 |
| Roadmap | Available | `docs/AEGIS_BUILD_PROGRESS.md`, `docs/PLAN.md` |
| Testing evidence | Available | CI workflow `.github/workflows/aegis-ci.yml`, Proof page `apps/web/src/content/proof.ts` |
| Known security findings and status | Available | `docs/AEGIS_FULL_PLATFORM_AUDIT.md` section 4, `docs/THREAT_MODEL.md`, `docs/SECURITY.md` |
| Independent penetration test report | Missing | Planned in Q2 |
| Deployment readiness | Partial | `docs/DEPLOYMENT.md`, `docs/DEMO_TO_PRODUCTION.md`. No verified production deployment. |
| Backup and recovery evidence | Partial | `docs/BACKUP_RECOVERY.md`. One manual restore. No automation. |
| Demo environment | Partial | Synthetic Meridian Gulf Bank tenant. A hosted URL is not verified in the repository. |

## Intellectual property

| Item | Status | Location or action |
|---|---|---|
| IP assignment from the founder to the company | Missing | Counsel to draft. Sign before closing. |
| Repository ownership | Partial | Personal account repository `jzaky/School`, shared with a separate product. Move AEGIS to a company-owned repository. |
| Licence decision for AEGIS source | Missing | No licence file. Decide proprietary terms with counsel. |
| Development provenance | Partial | Git history with commit trailers recording AI involvement. Add a founder-signed statement of direction, review and dates. |
| AI-generated code position | Missing | Counsel's memo on the AI provider terms that apply to the account used and on UAE copyright treatment |
| Open source inventory | Available | `docs/THIRD_PARTY.md`, generated from the production dependency tree, including licences requiring attention |
| Formal SBOM, in CycloneDX or SPDX format | Missing | Generate in Q1 from the same dependency tree |
| Copied or vendored third-party code | Available | `docs/THIRD_PARTY.md` "Adapted code" says no source was copied. Algorithms were implemented from public specifications. |
| GPL, AGPL, LGPL and other restricted licences | Available | No GPL or AGPL in production dependencies. LGPL in the optional prebuilt image library binaries. jszip is used under its MIT option. sax uses BlueOak-1.0.0. Counsel to confirm. |
| Contractual restrictions, including the DNRS NDA | Unknown | Counsel review in month 1 |
| Competitor comparison basis | Available | `docs/COMPARISON_DNRS.md` records that public pages were the only source |
| Trademark search and filing for "AEGIS" | Missing | Counsel |

## Commercial

| Item | Status | Location or action |
|---|---|---|
| Target market and segment rationale | Available | `AEGIS_ENTERPRISE_GO_TO_MARKET.md` |
| Customer pipeline | Missing | No pipeline exists. Start the CRM with discovery. |
| Pilot opportunities and letters of intent | Missing | None exist |
| Pricing assumptions | Partial | Hypotheses only. Pricing page with tiers and no prices. |
| Revenue model | Available | Per-deployment licence by agent count, plus pilots and services |
| Competition | Partial | `docs/COMPARISON_DNRS.md`, plus section 2 of the go-to-market document. Needs fuller research. |
| Customer contracts | Missing | Counsel in Q1 |

## Financial

| Item | Status | Location or action |
|---|---|---|
| Use of funds | Available | `AEGIS_INVESTMENT_USE_OF_FUNDS.md` |
| Burn rate, runway and scenarios | Available | `AEGIS_12_MONTH_FINANCIAL_MODEL.md`, `docs/strategy/model/` |
| Hiring plan | Available | `AEGIS_AI_FIRST_OPERATING_PLAN.md` section 6 |
| Operating costs, measured | Missing | Only assumptions. Replace with actuals after 60 days. |
| Future financing requirement | Available | Model: the conservative case needs a raise started by about month 9 |
| Historical financials | Unknown | Accountant |

## Unresolved issues an investor will raise

1. IP ownership and the personal-account repository.
2. The DNRS NDA.
3. AI-authored code without independent review or testing.
4. A solo founder with no human technical co-founder.
5. No customer evidence.
6. Valuation against comparable rounds.
7. Insurance and liability for a security product.
