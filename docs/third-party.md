# Third-party code and assets

Code or assets copied or adapted from outside sources. Only MIT, Apache-2.0 or BSD sources may be copied. AGPL or GPL sources (HeyForm, cal.diy, Frappe Education) are pattern references only, never pasted.

| Source | License | What we took | Where it lives |
|---|---|---|---|
| US Department of Education College Scorecard API (api.data.gov/ed/collegescorecard) | Public domain (US federal government data) | US institution names, cities, states, websites, admission rates, SAT/ACT middle 50% ranges and enrolment size, imported by `scripts/import-scorecard.ts` and the admin import | `src/server/pathways/scorecard.ts`, `prisma/seed/data/us-institutions.json.gz` (when generated) |
