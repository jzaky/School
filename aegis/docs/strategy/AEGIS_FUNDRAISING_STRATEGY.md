# AEGIS fundraising strategy

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13. The proposed terms are a planning position. They are not a market valuation, an offer, or evidence of investor interest. No financing is secured and no investor commitment exists.

## 1. Proposed terms (founder's directive)

| Metric | Amount |
|---|---|
| Pre-money valuation | AED 9,000,000 |
| New investment | AED 1,000,000 |
| Post-money valuation | AED 10,000,000 |
| Investor ownership | 10% |

The arithmetic is consistent: 1,000,000 divided by 10,000,000 is 10%.

## 2. Questions to settle before any investor meeting

1. **Which entity is the investor buying into?**
   - Nexus AI Assurance FZCO directly.
   - A holding company, for example in ADGM or DIFC, or offshore, that owns the FZCO.
   - A separate entity holding AEGIS.

   Many investors prefer a holding structure with a well-understood shareholder agreement regime. Counsel should advise, and the free zone's rules on share transfers and new shareholders apply.
2. **Does the company own AEGIS?** The code sits in a GitHub repository under a personal account, `jzaky/School`, beside a separate school operations product. The repository has no licence file. Every commit is authored by the Claude identity or a CI bot. Before closing:
   - Sign an IP assignment from the founder to the company.
   - Move AEGIS to a company-owned repository, preserving its history.
   - Have counsel confirm ownership of AI-assisted code under the AI provider's terms that apply to the account used, and under UAE copyright law.
3. **The DNRS relationship.** The directive budgets a DNRS NDA review, which suggests an NDA exists. An investor's counsel will ask whether any confidential DNRS information informed AEGIS. Get counsel's written view first. `docs/COMPARISON_DNRS.md` records that the comparison used public pages only, which is useful evidence but not a legal conclusion.
4. **Cap table today.** Record current shareholders, any promises of equity to advisers, and any founder loans.

## 3. Is AED 9,000,000 pre-money realistic?

**What supports it:**
- A working, tested product with breadth that is unusual for a pre-seed company.
- A clear, timely category.
- A UAE focus with private deployment.
- Low burn, because development runs on AI.

**What works against it:**
- No revenue, pilots or letters of intent.
- A solo founder with no human technical co-founder or engineering team.
- Code written almost entirely by an AI and not yet independently reviewed or tested.
- IP not yet assigned to the company.
- An open NDA question with a company in the same field.

**Expectation.** Investors will benchmark against recent comparable pre-seed rounds in the region. Collect 5 to 10 comparable data points from advisers or programs before setting terms. Do not rely on this document for a market figure. Expect pressure toward a lower valuation, an option pool, founder vesting, or milestone conditions.

## 4. Structure options

| Option | Terms (illustrative) | Investor ends with | Founder benefit | Founder cost |
|---|---|---|---|---|
| A. Priced round, as proposed | AED 1,000,000 at AED 9,000,000 pre-money | 10% | Simple, and clear governance | Most negotiation on valuation and full legal cost now |
| B. Convertible instrument with a valuation cap | AED 1,000,000 with an AED 10,000,000 post-money cap | 10% or less when it converts | Defers the valuation debate and reduces legal cost now | Converts at the cap if the next round is higher. Needs a jurisdiction where the instrument is well understood. |
| C. Two tranches | AED 500,000 at AED 9,000,000 pre-money, then AED 500,000 at AED 12,000,000 pre-money after milestones such as the security test passed and a paid pilot signed | 5.26% after tranche 1, about 9.05% after tranche 2 | Rewards progress with a higher price | Tranche 2 depends on milestones being met |
| D. Smaller raise | AED 600,000 at AED 6,000,000 pre-money, enough for the conservative budget less sales, then raise after pilots | 9.09% | Raises at a stronger position later | Less room for error |

**Option pool.** If an investor asks for a 10% option pool created before the investment, the founder's stake after option A falls to about 81%, not 90%. Negotiate whether the pool is pre-money or post-money and how large it really needs to be. The plan has no permanent hires before month 12.

**Recommendation.** Lead with option C, with option B as the fallback. Both tie price to evidence, and the plan's biggest uncertainties (security findings, demand) resolve within 6 months.

## 5. Non-dilutive and lower-dilution sources to investigate

Verify the current terms of each before relying on it.
- UAE innovation and startup programs, including incubators, accelerators and hub programs in Dubai and Abu Dhabi. Some offer incentives in exchange for relocation or licensing in their zone.
- Cloud provider startup credit programs. These could offset part of the AED 24,000 hosting line.
- AI provider startup programs. These could offset part of the AI usage line.
- Paid pilots, which are revenue, not dilution.

## 6. Investor targeting

**Profile.**
- Pre-seed and seed funds and angels active in the UAE and GCC, with B2B infrastructure or security portfolios.
- Strategic angels from banking risk, security or AI platform leadership. They also open procurement conversations.

**Avoid** investors whose involvement would create a conflict with target customers or with DNRS.

The founder researches and approves the list. A research agent may help later, under the restrictions in `NEXUS_AI_AGENT_ROADMAP.md`.

## 7. Process and timeline

| Weeks | Step |
|---|---|
| 1 to 4 | Legal and IP actions (section 2). Data room started (`AEGIS_INVESTOR_DUE_DILIGENCE_CHECKLIST.md`). Comparable rounds collected. |
| 3 to 6 | Pitch materials: deck, 2-minute demo video of the refund and treasury scenarios, financial model with all three scenarios, use of funds with gates |
| 5 to 12 | 20 to 30 investor conversations. Founder-led. Warm introductions preferred. |
| 10 to 16 | Term sheet, due diligence, documents, closing |

Because of the conservative scenario, the next raise must start by about month 9 after closing if no pilot has paid.

## 8. What not to say

Never claim any of the following:
- Customers, pilots, partners or government interest that do not exist.
- Certifications, independent audits or penetration tests that have not happened.
- That production deployments exist.
- That AI safety is proven.
- That investor interest is confirmed.
- Revenue figures other than those clearly labelled as scenario targets.

Use the Proof page wording (`apps/web/src/content/proof.ts`) as the source of approved product claims.
