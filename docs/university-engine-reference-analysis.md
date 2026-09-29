# University Engine Reference Analysis

Scope: six public repositories were shallow-cloned to `/tmp/claude-0/refs/` for inspection only. None of them is part of this repo. This document records what each one does, what its license allows, and which parts are useful for the Global University Requirements and Academic Pathway Engine.

Licensing rule (from CLAUDE.md hard rule 10): MIT, Apache or BSD code may be copied with an entry in `docs/third-party.md`. GPL, AGPL, or repos with no license file are pattern references only; we reimplement from the idea and paste nothing.

Paths below are relative to each repo root unless they start with `src/`, `prisma/` or `docs/` (ours).

## Summary table

| Repo | License (from file) | Copy code? | Most useful for us |
|---|---|---|---|
| bolewood/collegedata-fyi | MIT, (c) 2026 Anthony S. and Bolewood Group, LLC. Exception: `data/discovery/` is CC BY-SA 4.0 | Yes for code, with attribution. No for `data/discovery/` content | Source archiving with SHA-256, provenance columns, extraction artifacts per producer, evidence-validated LLM extraction, change events with human review gate, CDS canonical schema (C5 high school units, C8 test policy, C14 to C22 deadlines), Scorecard CSV column map with drift guard, percentile positioning |
| granitehq/college-tools | MIT, (c) 2025 Granite HQ, LLC | Yes, with attribution | Scorecard API field list and mappings, resilient API client, Reach/Match/Likely formula, deadline resolver with source labels, task plan generator, reconcile that preserves user edits |
| BEFICENT/surriculum | GNU GPL v3, (c) 2025 Bilal Mehmet Gebenoglu | No. Patterns only | Requirement groups as data, rule evaluators, allocation cascade, prerequisite expression AST with min grade and concurrency, candidate impact (what-if) simulation, content-hash data manifest, daily scrape with validation gates |
| mofidumar15/AGENTIC-RAG-COURSE-PLANNING-ASSISTANT | No LICENSE file (all rights reserved) | No. Patterns only | Mostly a cautionary example: LLM eligibility answers without deterministic checks |
| lashhw/applytool | MIT, (c) 2019 黃彥傑 | Yes, with attribution (little worth copying) | Per-subject threshold bands and include/exclude subject filters over scraped admission criteria |
| aslanu11/Math-Student-Launchpad | No LICENSE file. README says "MIT License" with no copyright holder | Treat as patterns only (conservative) | UCAS 5-choice tracker, apprenticeship kanban, deadlines list, readiness rings |

---

## 1. bolewood/collegedata-fyi

### Architecture
- Monorepo with twelve independent pipelines described in `docs/ARCHITECTURE.md`: schema, corpus, discovery, mirror, extraction, Scorecard, institution directory and coverage, IPEDS baseline, FSA nonpayment, change intelligence, consumer API, frontend.
- Storage and API: Supabase Postgres plus Storage, PostgREST as the public read API, Supabase Edge Functions (Deno, TypeScript) under `supabase/functions/` for discovery and archiving (`archive-process`, `archive-enqueue`, `discover`, `refresh-coverage`, `browser-search`).
- Extraction: Python worker `tools/extraction_worker/worker.py` routes each archived document by byte-sniffed format to a tier: filled XLSX, fillable PDF (`tools/tier2_extractor/`), flattened PDF via Docling plus `tools/extraction_worker/tier4_cleaner.py`, image scans via forced OCR, structured HTML (`html_to_markdown.py`). DOCX is scoped but not built (PRD 007).
- LLM fallback: `tools/extraction_worker/tier4_llm_fallback.py` and `llm_fallback_worker.py` run only on low-coverage Tier 4 documents and write a separate artifact.
- Frontend: Next.js 16, React 19, Tailwind 4, Vitest, Playwright (`web/package.json`), logic in `web/src/lib/`.
- 103 SQL migrations in `supabase/migrations/`.

### License
- `LICENSE`: MIT License, Copyright (c) 2026 Anthony S. and Bolewood Group, LLC.
- README exception: curated discovery content under `data/discovery/` is CC BY-SA 4.0 (`data/discovery/LICENSE`). Share-alike: do not copy that content into our repo.
- Copying code: allowed with attribution in `docs/third-party.md`.

### Data model
- `cds_documents` (`supabase/migrations/20260413201910_initial_schema.sql`): one row per (school_id, sub_institutional, cds_year) with source provenance (`source_url`, `source_format`, `source_sha256`, `source_page_count`), lifecycle (`participation_status`, `discovered_at`, `last_verified_at`, `removed_at`, `extraction_status`). CHECK constraints enumerate every status value.
- `source_provenance` column (`20260419100000_source_provenance.sql`): `school_direct`, `mirror_college_transitions`, `operator_manual`. Mirror rows never overwrite a school-direct row; a later school publication upgrades the row.
- `cds_artifacts`: one row per derived file with `kind` (source, canonical, raw_docling, cleaned, ...), `producer`, `producer_version`, `schema_version`, `sha256`, `notes` jsonb. Multiple producers coexist; consumers choose.
- `cds_selected_extraction_result` view (`20260426120000_queryable_browser_backend.sql`): producer precedence tier1_xlsx > tier2_acroform > tier6_html > tier4_docling, then overlays LLM fallback values only into gaps (deterministic value wins on conflict).
- `cds_fields`: long-form projection keyed by (document_id, schema_version, field_id) with `value_text`/`value_num`/`value_bool`, `value_kind` (number, percent, currency, text, yesno, checkbox, unknown, not_applicable), `value_status` (reported, missing, not_applicable, parse_error), `producer`, `data_quality_flag`, `archive_url`. Percent values are constrained to 0 to 1.
- `cds_field_change_events` and `cds_field_change_event_reviews` (`20260505180000_change_intelligence.sql`): from/to document, from/to value, absolute and relative delta, `event_type` (material_delta, newly_missing, newly_reported, reappeared, format_changed, producer_changed, quality_regression, quality_recovered, card_quality_changed), `severity` (watch, notable, major), `threshold_rule`, `evidence_json`, `verification_status`, `public_visible` default false. Reviews carry `verdict` (confirmed, extractor_noise, ambiguous, not_reportable) and `source_pages_checked`.
- `cds_llm_cache` (`20260420140000_cds_llm_cache.sql`): unique on (source_sha256, section_name, schema_version, model_name, prompt_version, strategy_version, cleaner_version, missing_fields_sha256), with token counts and estimated cost.
- Canonical schema JSON `schemas/cds_schema_2025_26.json`: 1,105 fields, each with `question_number` (A.001 ...), `section`, `subsection`, `category`, `value_type`, optional `value_options` decoder. Cross-year diffs in `schemas/*.diff.json`.
- `scorecard_summary`: curated 43-column subset of the Scorecard institution CSV, one row per UNITID.

### Ingestion
- Discovery and archive (`supabase/functions/_shared/archive.ts`): download with caps, reject auth walls and truncated files, sniff extension from content type, URL and magic bytes, store at SHA-addressed path `sources/{school_id}/{cds_year}/{sha256}.{ext}`. Three branches: no row -> insert; same SHA -> verify storage object exists, bump `last_verified_at` (`unchanged_verified`) or re-upload (`unchanged_repaired`); new SHA -> upload, update document first, then insert artifact (`refreshed`). The comments explain why document-first ordering is self-healing on crash.
- Freshness signal order (`web/src/lib/freshness.ts`): embedded modification date, embedded creation date, HTTP Last-Modified, then discovered_at, each with a human label.
- Academic year is detected from document content, not the URL (ADR `docs/decisions/0007-year-authority-moves-to-extraction.md`).
- Publish raw alongside clean (ADR `docs/decisions/0002-publish-raw-over-clean.md`): each cleaner is a separate artifact with its own producer tag.
- Scorecard CSV loader `tools/scorecard/refresh_summary.py`: `COLUMN_MAP` from our column names to Scorecard columns, with (PUB, PRIV) tuples for net price variants, `BOOL_MAP`, `INT_COLS`, `NUMERIC_COLS`, and a schema-drift guard that aborts with the list of missing columns when a release renames a column.

### Useful algorithms
- LLM output validation `tools/extraction_worker/tier4_llm_fallback.py` `validate_response` (lines around 607 to 700): reject field IDs outside the requested subsection, reject values already extracted deterministically (no-clobber), type check by `value_type`, require `evidence_text` to be a verbatim substring of the source (exact, then whitespace-collapsed; `_evidence_present`), require the value itself to appear in the evidence (`_value_in_evidence`), range sanity (`_sanity_check`: percent 0 to 100, non-negative counts and currency), and a row-merge guard when evidence spans several field labels.
- Change classification `tools/change_intelligence/project_change_events.py` `classify_field_change` and `severity_for_delta`, driven by `tools/change_intelligence/rules.yaml`: thresholds in percentage points for rates and absolute plus relative with a minimum denominator for counts; severity capped to `watch` when source provenance changed; a missing value after a producer or format change becomes `producer_changed`/`format_changed`, not `newly_missing`; `major` and `newly_missing` events need human verification. Deterministic event IDs are `sha256` of the key parts, truncated to 32 hex chars (`event_id`).
- Academic positioning `web/src/lib/positioning.ts`: `interpolatePercentile` (piecewise linear through p25/p50/p75, clamped 5 to 95), `hasMonotonicAnchors`, `classifyAcademicFit` (above_range when more than 100 SAT or 2 ACT points past p75), `classifyAdmissionsOutlook` by admit rate (<0.10 high reach, <0.25 reach, <0.50 possible, else likely), suppression of the tier to `unknown` when admit rate is under 15 percent and the score is inside the middle 50, and an explicit `caveats` list (stale_cds, low_sat_submit_rate, no_test_data, ...).
- Match list `web/src/lib/list-builder.ts`: `testPolicySignal` (high submit rate >= 0.85, mostly non-submitters <= 0.10), filters, `dedupeMatchSchools`, `rankMatchSchools`, CSV export.
- Admission strategy `web/src/lib/admission-strategy.ts` `computeAdmissionStrategy`: ED admit rate, non-early residual admit rate, ED share of class, wait list rates, with consistency checks before any rate is shown.

### UI concepts
- Every number cites its source (CDS, IPEDS or Scorecard) and links to the archived file.
- Coverage transparency page (`/coverage`) with honest statuses ("No public CDS found", "Not checked yet") instead of hiding gaps.
- "What changed" card shows only human-reviewed public change events.
- Per-school spreadsheet downloads (`web/src/app/schools/[school_id]/[year]/cds.xlsx`, `cds.csv`).

### Reusable components (MIT)
- `web/src/lib/positioning.ts` and its tests `positioning.test.ts`.
- `web/src/lib/freshness.ts`.
- The validation checks in `tier4_llm_fallback.py` (Python; we would port to TypeScript).
- `rules.yaml` threshold shape and `severity_for_delta` logic.
- Canonical schema JSON for the CDS fields we need (C.401, C.501 to C.524, C.801 to C.8G07, C.1401 to C.1405, C.2101 to C.2206).

### Strengths
- Provenance and honesty are designed in: every row knows its source URL, SHA-256, producer, producer version and quality flag.
- Idempotent, crash-safe archiving with explicit outcome labels.
- Deterministic first, LLM only as a gap filler with strict validation.
- Review gate before any change becomes public.

### Weaknesses
- US-only, CDS-specific. CDS C5 lists Carnegie unit counts per subject area, not named courses, grades or international qualifications.
- Heavy operator tooling (many Python scripts) that we do not need.
- Tier 4 extraction quality varies (documented in `docs/extraction-quality.md` and `docs/known-issues/`).

### Exact pieces useful to our build
1. The SHA branch logic (insert, unchanged_verified, unchanged_repaired, refreshed) for our `RequirementSource` fetcher.
2. `source_provenance` enum pattern and the rule that the official source always wins over a mirror.
3. Artifact per (producer, producer_version) with precedence, so a human-reviewed requirement set beats an LLM draft.
4. Evidence-substring validation for LLM extraction of requirement pages.
5. Change event types, severity rules and `public_visible=false` default with a review table.
6. Positioning functions for US programs (SAT/ACT percentile and outlook with caveats).
7. Scorecard CSV `COLUMN_MAP` with PUB/PRIV variants and the drift guard.
8. CDS fields C.501 to C.524 (units required and recommended by subject area) as a US baseline for "high school units" requirements, and C.1401 to C.2206 for deadline data.

---

## 2. granitehq/college-tools

### Architecture
- Google Apps Script (V8) project bound to a Google Sheets workbook. ES5-style namespaced IIFE modules under `src/` (`CollegeTools.Scorecard`, `CollegeTools.Admissions`, `CollegeTools.TaskPlanner`, ...). Deployed with `clasp`.
- Node test harness with mocked Apps Script globals under `test/` (README says 27 suites). Static marketing site under `website/`.

### License
- `LICENSE`: MIT License, Copyright (c) 2025 Granite HQ, LLC. Copying allowed with attribution.

### Data model
- Sheets with fixed headers defined in `src/config.js` `HEADERS`: Colleges, Application Timeline, Application Status Tracker, Financial Aid Tracker, Scholarship Tracker, Campus Visit Tracker, Tasks, Task Templates, This Week, Recruiting Tracker.
- Stable `College ID` (UUID) on Colleges and four trackers, replacing name matching (`project-docs/plans/2026-07-06-stable-college-identity.md`).
- Application Timeline holds per-college round (ED/ED2/EA/REA/RD), application deadline, test score, transcript, counselor and teacher rec deadlines, decision release date, deposit dates.
- Tasks carry `Template ID`, `Scope ID`, `Schedule Rule`, `Anchor Date`, `Owner`, `Owner Locked`, `Date Locked`, `Priority Override`, `Dependencies`, `Blocked By`, `Evidence Source`, `Generated`, `Archived Reason`.

### Ingestion
- College Scorecard API client `src/scorecard.js`: base URL `https://api.data.gov/ed/collegescorecard/v1/schools`, retries with exponential backoff on 5xx and 429 (`shouldRetry`, `calculateBackoffDelay`, base 300 ms, max 10 s, 3 attempts per `src/config.js` `API_CONFIG`), response cache keyed by MD5 of the URL, execution-time guard, bounded concurrency (`BATCH_FETCH_SIZE: 4`).
- Name resolution with three strategies (`searchColleges`, `fetchCollegeData`, `fetchCollegeDataBatch`): exact `school.name`, regex contains `~.*name.*`, then fuzzy `school.search`. Batch path deduplicates names and only falls back for empty results.
- Field list `src/config.js` `API_FIELDS` (19 fields): ownership, locale, admission rate, 4-year full-time retention, suppressed completion rate, 10-year median earnings, cost of attendance, average net price, in-state and out-of-state tuition, SAT 25th/75th math and reading, SAT average, ACT 25th/75th, `latest.admissions.test_requirements`, Pell grant rate, median completer debt.
- Row refresh `src/colleges.js` `fillCollegeRowCore`: writes only API-owned columns, preserves user ratings, formulas and notes (`shouldPreserveHeader`, `isAutoStampNotes_`).

### Useful algorithms
- Scorecard mappings in `src/colleges.js`: `testOptionalFromRequirement_` (1 required, 2 recommended -> not optional; 3, 4, 5 -> optional), `campusSettingFromLocale_` (11 to 13 City, 21 to 23 Suburban, 31 to 33 Town, 41 to 43 Rural), SAT composite from math plus reading percentiles with average fallback; `src/scorecard.js` `typeFromOwnership` (1 Public, 2 Private nonprofit, 3 Private for-profit).
- Admission Fit `src/formulas.js` `fitBand` and `admissionFit`: score >= p75 -> 2, >= p25 -> 1, else 0; GPA adjusts one notch (>= 3.9 up, < 3.2 down); acceptance under 15 percent is always Reach; SAT first, ACT if no SAT, "Test Optional" when no bands.
- Weighted score `src/scoring.js`: SUMPRODUCT of 1 to 5 ratings with weights, excluding unrated criteria from the denominator.
- Task plan `src/task-planner.js`:
  - `COLLEGE_DEADLINE_RESOLVERS` and `deadlineFor_` return a date plus a source label ("College application deadline", "Application-round default; confirm manually", "National Candidates Reply Date default (May 1)", "AP/IB score-sending deadline (June 20)").
  - `applicationRoundDeadline_`: when only the round is known, RD/ED2 default to Jan 15, Rolling to Feb 1, other rounds to Nov 1.
  - `urgencyFor_`: overdue -> Critical ("Late start" or "Missed deadline"), <= 14 days Critical, <= 30 High, <= 90 Normal, else Low.
  - `adaptLateStartSchedule_`: when a family starts late, maps each task's ideal position proportionally into the remaining window and flags infeasible tasks.
  - `alignDependencyDates_`: moves a task after its latest prerequisite, or flags a conflict when the task is anchored to a fixed date.
  - `reconcile` and `mergeTask_`: regeneration keeps notes, completion, locked owner, locked date, overrides, and completed tasks as audit records; tasks no longer applicable become Skipped with an archive reason; returns a preview count (add, update, archive, reassign, reschedule).
  - `updateDependencyState_`: one-directional Not Started -> Ready when dependencies complete.
- Task catalog `src/task-catalog.js`: 15 workstreams and template rows (id, task, owner role, support role, applicability, effort minutes, deliverable). README states 109 templates.

### UI concepts
- "Preview before you commit" for regeneration.
- "This Week" rolling 90-day view by owner and college.
- Dashboard "What's Due Next" with overdue and due-soon warnings.
- Conditional colors for Likely, Match, Reach.

### Reusable components (MIT)
- `API_FIELDS`, `testOptionalFromRequirement_`, `campusSettingFromLocale_`, `typeFromOwnership`, backoff helpers.
- `fitBand` logic (port from sheet formula to TypeScript).
- Deadline resolver pattern, `urgencyFor_`, `adaptLateStartSchedule_`, `alignDependencyDates_`, `reconcile`/`mergeTask_`.

### Strengths
- Honest labeling of where each date came from, including defaults that must be confirmed.
- Regeneration that never destroys user edits.
- Well-tested pure logic despite the spreadsheet host.

### Weaknesses
- Spreadsheet host, single family, no multi-tenancy, API key stored in a sheet cell.
- US-only (Common App rounds, FAFSA, CSS Profile).
- Name-based matching was the original identity; the stable ID migration shows the cost.

### Exact pieces useful to our build
1. Extend `src/server/pathways/scorecard.ts` `SCORECARD_FIELDS` with the cost, outcome, ownership, locale and `test_requirements` fields from `src/config.js` `API_FIELDS`, and port the three mapping helpers.
2. Port the retry/backoff policy (5xx and 429 only) into our importer, which today throws on 429 (`ScorecardError("rate_limited")`).
3. Deadline engine: resolver per deadline kind returning `{date, source}`, with round defaults marked as needing confirmation.
4. Task generation plus reconcile semantics for application checklists (replaces the fixed `CHECKLIST` with `weeksBefore` in `src/server/pathways/shortlist.ts`).

---

## 3. BEFICENT/surriculum

### Architecture
- Static, dependency-free browser app for Sabanci University degree planning (`README.md`, `docs/architecture.md`). No server or database; plans live in browser storage with export/import.
- Domain modules under `scripts/domain/` (requirement engine, allocation, progress, grades, suggestion ranking, candidate impact), prerequisite policy in `scripts/requisites/expression-policy.js` and `scripts/course_requisites.js`, scheduler under `scripts/scheduler/`.
- Python data pipeline `tools/data_pipeline/` scrapes the university's SUIS pages (`fetch_courses.py`, `fetch_requirements.py`, `scrape_coursepages.py`, `fetch_schedule.py`) and writes JSONL per term.
- Daily GitHub Action `.github/workflows/daily-data-refresh.yml` scrapes, normalizes, rebuilds the manifest only if data changed, runs data validation tests, then opens a pull request for human merge.
- Playwright E2E plus unit tests in `tests/`.

### License
- `LICENSE`: GNU General Public License v3, Copyright (C) 2025 Bilal Mehmet Gebenoglu.
- Copying code: not allowed. Patterns only; we reimplement.

### Data model
- Courses: `courses/<term>/<MAJOR>.jsonl`, one course per line with `Major`, `Code`, `Course_Name`, `ECTS`, `SU_credit`, `Faculty`, `EL_Type` (university, required, core, area, free), `Faculty_Course`, `Basic_Science`, `Engineering`.
- Requirements: `requirements/<term>.jsonl`, one program per line with credit minimums per type (`university`, `required`, `core`, `area`, `free`, `total`, `ects`), `humRequired`, `humRule`, `facultyReq`, and an ordered `groups` array.
- Group record (`docs/requirement-groups-design.md` section 3): `id`, `label`, `base` (the course type it is a subset of), `rule`, rule parameters (`min`, `max`), membership as `members` (explicit list) or `match` (predicate), optional `exclusivePairs`, `flag`, and `suis` citation of the source page section.
- Data manifest `data/manifest.json`: content-derived `dataVersion`, per-term hashes, input file hashes.

### Ingestion
- Scrapers validate that the page shown matches the requested term (`tools/data_pipeline/suis_page_validation.py` `require_matching_admit_term`), validate each requirement record (`fetch_requirements.py` `validate_requirement_record`), and write atomically per term (`write_requirements_term_atomic`).
- `tools/data_pipeline/build_manifest.py`: SHA-256 per file, order-independent combined hash per term, truncated to 16 hex chars, so the version changes only when data changes.
- Change control: automated refresh never merges itself; it opens a PR with fast data gates (`tests/requirements_validation_test.py`, `tests/scrape_groups_test.py`, `tests/manifest_integrity_test.py`).

### Useful algorithms
- Rules as data `scripts/domain/requirement-engine.js`: `RULE_EVALUATORS` maps a rule type to a predicate (`hasCourse`, `hasAny`, `hasDistinctAny`, `poolCreditSum` with exclusive pairs, `levelCreditSum`, `languageCap`, `entryGatedOneOf`, ...). `evaluateRules` returns the first unmet rule; unknown rule types are skipped rather than crashing.
- Per-group progress rows `groupProgressFor`: `{ id, label, suis, base, current, target, unit, ok, isCap, note }` so the UI shows "6 of 9 credits" rather than pass/fail only. Entry-term gated rules report "Not required for your admit term".
- Base-type inheritance (design doc section 4): a group measures the composition of a base pool, so a course is counted once for credit and the group only measures it. The doc explicitly rejects separate allocation lanes because they cause double counting.
- Allocation cascade `scripts/domain/curriculum-allocation.js` `allocateCascade`: surplus spills required -> core -> area -> free; `pinCore` forces named-pool courses; zero-credit required courses never overflow. `resolveAlternativeRules` runs before the cascade to handle "one of A or B" pairs where the extra course counts elsewhere.
- Prerequisite expressions `scripts/requisites/expression-policy.js`: tokenizer that also reads per-course qualifiers ("Min Grade C", "can be taken concurrently"), shunting-yard parse with `and` binding tighter than `or`, flattened AND/OR AST, AST cache. `evaluatePrerequisites` returns `null` when met, otherwise `{ required[], concurrent[], oneOf[][] }` so the UI can say "take X" or "take one of (Y / Z)". `minimumPriorSuRequirement` handles "58 prior credits" rules.
- Term semantics (`README.md`, `scripts/course_requisites.js`): prerequisites look strictly earlier than the target term; only explicit concurrent clauses may use the same term; failed and withdrawn courses do not count.
- What-if simulation `scripts/domain/suggestion-candidate-impact.js`: for each candidate course, re-runs allocation and group progress on a term-scoped snapshot and reports the impact per group.
- Suggestion ranking `scripts/domain/suggestion-ranking.js`: type weights (university 36, required 28, core 18, area 12, free 0), `marginalEffectiveType` based on which pools still need credit, a bonus of 6 for members of unmet groups, small credit term. Returns a score breakdown, not just a number.
- Offering history `scripts/course-filter-offering-history.js` `deriveOfferingPattern`: advisory tags such as "No Fall offerings found" and "Not offered every year" from recorded offerings; an exact published offering for the target term suppresses warnings.

### UI concepts
- Semester board with drag and drop plus keyboard move picker; semester order is presentational, term codes are authoritative.
- Course picker filters: program category, level, credit, exact-term offering, already planned, prerequisite met.
- Advisory warnings that never block ("planned/completed", not "officially earned").
- Graduation summary with per-group progress rows.

### Reusable components
- None to copy (GPL-3.0). Every item above must be reimplemented from the described behavior.

### Strengths
- The clearest model in this set for structured requirements with ONE_OF, N_OF, credit pools and caps, each citing its source.
- Pure domain modules with dependency injection, heavily tested.
- Data refresh with validation gates and human merge.

### Weaknesses
- One university, credit-based undergraduate rules; no grade thresholds per subject beyond "Min Grade" on prerequisites.
- Legacy numeric `flag` codes and first-unmet-wins ordering are tied to the university's messaging.
- Browser-only storage.

### Exact pieces useful to our build (patterns)
1. Requirement node shape with `base`/`strength`, `rule`, `min`/`max`, `members` or `match`, and a `source` citation.
2. Progress rows with current/target/unit instead of boolean only.
3. Expression AST with per-leaf min grade and concurrency, and a result that lists what is missing and the alternative sets.
4. Candidate impact simulation for course unlock and what-if analysis.
5. Strictly-earlier-term prerequisite semantics for the grade 9 to 12 planner.
6. Content-hash manifest plus "open a review, never auto-merge" for requirement refresh.

---

## 4. mofidumar15/AGENTIC-RAG-COURSE-PLANNING-ASSISTANT

### Architecture
- A single Colab notebook `notebook_View.ipynb` plus `README.md`, `data-urls.txt`, `requirements.txt`, `sample_outputs.txt`, `evaluation_results.csv`.
- LangChain `WebBaseLoader` loads 25 US university catalog URLs, `RecursiveCharacterTextSplitter` (chunk 800, overlap 150), HuggingFace `all-MiniLM-L6-v2` embeddings, Chroma vector store, `k=5` retrieval, `google/flan-t5-base` as the LLM through `RetrievalQA`.
- "Agents" are plain functions: `intake_agent` (checks `major`, `completed_courses`, `target_term` keys), `retriever_agent`, `planner_agent` (prompt), `verifier_agent` (prompt).

### License
- No LICENSE file and no license statement in the README. All rights reserved by default. Patterns only; copy nothing.

### Data model
- A Python dict student profile (`major`, `completed_courses`, `target_term`, optional `interests`, `credits_completed`). No course or requirement schema; knowledge is unstructured chunks in Chroma.

### Ingestion
- One-shot web load of catalog pages. No hashing, change detection, or structured extraction. Several URLs in `data-urls.txt` carry `utm_source=chatgpt.com`.

### Useful algorithms
- Intake completeness check that returns clarifying questions before answering (`intake_agent`).
- Output contract in the prompt: answer, reasons, citations, clarifying questions, assumptions.

### UI concepts
- Console loop printing answer and source URLs (`ask_question`).

### Reusable components
- None.

### Strengths
- States the right goals: cite sources, ask when data is missing, abstain when not in the catalog.

### Weaknesses (factual, from the files)
- `verifier_agent` receives `retrieval["sources"]` (a list of URLs), not the retrieved text, so it cannot check grounding.
- `sample_outputs.txt` shows "can i take CS101" answered "No" and "Who is the professor for Database Systems" answered "C S 386D", which contradicts the abstention claim.
- `evaluation_results.csv` lists 40 questions that differ from the notebook's `test_queries`, and every row is marked correct (1); the notebook does not compute that file.
- Prerequisite decisions are left to a small generative model with no deterministic check.

### Exact pieces useful to our build
1. Only the negative lesson: eligibility must be computed by a deterministic engine over structured requirements. LLMs may draft structured extractions, with evidence validation and human review, never answer eligibility.
2. The "clarifying questions when inputs are missing" idea maps to our `unknown` status plus a prompt to record the missing grade or test.

---

## 5. lashhw/applytool

### Architecture
- Static site (`index.html`, `apply.html`, `advanced.html`) with jQuery, Bootstrap 4 and floatThead from CDNs, and small scripts `js/common.js`, `js/apply.js`, `js/advanced.js`.
- Python scrapers under `data/apply/` and `data/advanced/` produce `data.json` and `id.json` for Taiwan's university admission year 110 (2021): individual application (學測個人申請) and exam placement (指考分發).

### License
- `LICENSE`: MIT License, Copyright (c) 2019 黃彥傑. Copying allowed with attribution, though little is worth copying.

### Data model
- Apply (`data/apply/data.json`): per department `{ id, school, name, s1..s6, const }`. `s1..s5` are the required GSAT standard band per subject (頂標 top, 前標 front, 均標 average, 後標 back, 底標 bottom) or 一階/二階 (used only in first or second stage screening) or `--`. `const` is a y/n array marking which subjects are hard screening thresholds.
- Advanced (`data/advanced/data.json`): `subjects` maps subject code to weight multiplier (for example "1.50"), `subjects_gsat` maps GSAT subject to a required band.

### Ingestion
- `data/apply/parse_id.py` walks the official index page for department IDs; `data/apply/parse_data.py` fetches each department page from `cac.edu.tw` and walks `<td>` cells by label. `data/advanced/parse_id.py` evaluates a remote JS file with `js2py` to get IDs; `parse_data.py` decodes Big5 pages and normalizes with NFKD.
- No hashing, no change detection, no provenance beyond linking back to the source page in the results table.

### Useful algorithms
- `js/apply.js` `search`: name and school substring match, then hide rows whose (subject, band) pair is in the exclusion filter list.
- `js/advanced.js` `search`: two filter lists, one hiding programs that use a subject and one hiding programs that do not.
- `js/common.js` `checkName`: plain substring mode or regex mode built directly from user input with `new RegExp(...)`.

### UI concepts
- Dense comparison table: one row per program, one column per subject, cell shows the required band colored by band (`css/apply.css` `.standard_1` to `.standard_7`), grey text when a subject is not a hard threshold.
- Subject by band checkbox matrix to filter programs.
- Paging with a "more results" button (50 per page).

### Reusable components
- Nothing substantial; the band color scale idea is trivial to reimplement.

### Strengths
- A compact, readable way to compare subject thresholds across many programs.

### Weaknesses
- One admissions year, frozen data, positional HTML scraping that breaks on layout change, user-supplied regex (ReDoS risk), no i18n or accessibility work.

### Exact pieces useful to our build
1. A "requirements matrix" view: programs as rows, canonical subjects as columns, cells showing minimum level and grade, with visual distinction between REQUIRED and RECOMMENDED.
2. The explicit split between "threshold that screens" and "subject that is only counted", which maps to our REQUIRED versus RECOMMENDED strength.

---

## 6. aslanu11/Math-Student-Launchpad

### Architecture
- One offline page `Launchpad-Finance-Tracker/index.html` with `assets/js/app.js` (about 2,000 lines, vanilla JS, hash router) and `assets/css/style.css`. State in `localStorage` under `launchpad_finance_state_v1`, JSON export/import.

### License
- No LICENSE file. `README.md` has a "License" heading that says "MIT License. Free to use, modify, and distribute." with no copyright holder or license text. We treat it as patterns only to stay conservative.

### Data model (`app.js` `defaultState`)
- `profile` (school, target year, predicted grades and GCSE results as free text), `ucasChoices` (university, course, course code, status, entry requirements text, tests, interview notes, links), `apprenticeships` (company, role, stage), `personalStatement` (current text, versions, paragraph bank), `entryTests` (registration deadline, test date, practice log), `supercurricular`, `documents`, `resources`, `deadlines` (`{ title, date, relatedType, relatedId, notes, done }`).

### Ingestion
- None. All data is typed by the student.

### Useful algorithms
- `computeReadiness`: fixed-weight heuristic scores (UCAS, apprenticeships, portfolio, overall) from counts and filled fields.
- `addUcasChoice` enforces a maximum of 5 UCAS choices.
- UCAS status options: Researching, Shortlisted, Firm choice candidate, Applied, Offer, Rejected. Apprenticeship kanban stages `KANBAN_STAGES`: Researching, Applied, Online Tests, Interviews/AC, Offer, Rejected.
- `buildSearchIndex`: flattens all records into typed chunks for a global search modal.
- Per-choice "add deadline" creates a linked deadline row (`relatedType`, `relatedId`).

### UI concepts
- Dashboard with progress rings and "Next Deadlines" table; side-by-side comparison of UCAS choices; kanban pipeline; statement editor with word count and saved versions.

### Reusable components
- None copied (license unclear). The UI ideas are generic.

### Strengths
- Covers the UK route end to end (UCAS, admissions tests, statement, apprenticeships) in a simple mental model.

### Weaknesses
- Entry requirements are free text, so nothing can be checked. Single user, browser-only data, no validation, readiness weights are arbitrary.

### Exact pieces useful to our build
1. UCAS 5-choice cap as a route rule in the application tracker.
2. Deadlines linked to an application with a related type and id.
3. Degree apprenticeship as a separate pathway type with its own stage list (not in our current model).

---

## How the findings relate to our current code

Current state, read from the repo:

- `prisma/schema.prisma` `University`: optional `orgId` (null for the global catalog), `acceptanceRate` as an integer percent, `deadlineMonth`, `applyVia`, `scorecardId`, `stats Json`. SAT/ACT ranges are not columns; they are read from the gzip snapshot by `src/server/pathways/us-data.ts` `usStats`.
- `UniversityProgram`: `requiredSubjects` and `recommendedSubjects` as flat string arrays, `requirements Json` keyed by curriculum (`ProgramRequirements` in `src/server/pathways/types.ts` covers BRITISH, IB, AMERICAN, UAE_MOE, JORDAN_TAWJIHI), `englishReq Json`, one `sourceUrl` and `lastVerifiedAt` for the whole program, `indicative` flag. No content hash, no per-requirement provenance, no ONE_OF or TWO_OF, no versioning per admission cycle.
- `SchoolCurriculum` enum already includes CBSE, ISC and SABIS, but `REQ_CURRICULA` and `ProgramRequirements` do not, and GCSE/IGCSE are only levels under BRITISH (`RESULT_LEVELS`).
- `StudentSubjectResult`: `subjectCode`, `curriculum`, `level`, `predicted`, `achieved` as strings. `StudentTestScore`: `kind`, `score`.
- `src/server/pathways/checker.ts` `checkRequirements`: already deterministic and three-valued (met, not_met, unknown), tracks `provisional` (predicted) and `unconfirmed` (not counselor-confirmed), returns `classesToTake` with `offered` from the school's subjects, and `scoreGaps`. Grade comparison (`meets`) understands A-level letters only; everything else is numeric. Any-of logic exists only for English tests and SAT/ACT.
- `src/server/pathways/scorecard.ts`: 13 Scorecard fields, idempotent import keyed by `scorecardId` then normalized name, throws on 429 instead of retrying.
- `src/server/pathways/shortlist.ts`: `categoryFor` uses the checker then `suggestCategory` (acceptance under 25 percent Reach, under 60 Target, else Safety, in `src/server/career/scoring.ts`). Checklist is a fixed list with `weeksBefore`. `ShortlistEntry` has one `deadline`.
- `src/server/career/scoring.ts` `matchCareers`: deterministic weighted dimension fit with subject bonus; `Career.subjects` uses the same subject codes as pathways (`src/server/pathways/subjects.ts` `PATHWAY_SUBJECTS`).

The checker is a sound base: keep its three-valued output and provisional/unconfirmed flags, and replace the per-curriculum JSON with a requirement tree plus a grade scale model.

---

## Recommendations for our build

### A. Schema ideas (Prisma, all tenant tables carry orgId; global catalog rows use orgId null as `University` does today)

Canonical subjects and curriculum mapping
- `CanonicalSubject` (global): `code` (MATH, PHYS, ...; reuse `PATHWAY_SUBJECTS`), `nameEn`, `nameAr`, `family` (STEM, LANGUAGE, HUMANITIES, ARTS).
- `Qualification` (global): `curriculum` (extend `SchoolCurriculum` usage to all nine systems), `code` (GCSE, IGCSE, AS_LEVEL, A_LEVEL, IB_HL, IB_SL, AP, US_HONORS, US_CORE, CBSE_XII, ISC_XII, SABIS_G12, UAE_MOE_ADVANCED, UAE_MOE_ELITE, UAE_MOE_GENERAL, TAWJIHI_SCIENTIFIC, ...), `gradeScaleId`, `levelRank` (so "A-level or higher" can be evaluated).
- `GradeScale` and `GradeScaleStep` (global): ordered steps with `label` and `rank` (A* A B C D E U; IB 7 to 1; percentages 0 to 100 as a numeric scale; CBSE and ISC percentages; Tawjihi averages). Generalizes `aLevelRank` in `checker.ts`. Only compare within one scale; cross-scale equivalence exists only when a program lists it.
- `CurriculumCourse` (global): `qualificationId`, `code`, `nameEn`, `nameAr`, `canonicalSubjectId`, `equivalence` (EXACT or PARTIAL, for example Further Maths counts as Maths for some programs only when the program says so).
- `SchoolCourseOffering` (tenant): `orgId`, `curriculumCourseId`, `grades` (9 to 12), `termsOffered`, `prerequisiteExpr` (text parsed into an AST at write time, pattern from surriculum), `active`. This is the catalog the planner is constrained to; it replaces the `offered` list built from `Subject.code` in `src/server/pathways/profile.ts`.

Structured requirements with provenance
- `RequirementSet` (global or tenant): `programId`, `curriculum`, `admissionCycle` (for example 2027), `version`, `status` (DRAFT, IN_REVIEW, PUBLISHED, SUPERSEDED), `producer` (MANUAL, LLM_DRAFT, IMPORT) and `producerVersion`, `reviewedById`, `reviewedAt`, `sourceSnapshotId`. Precedence when several exist: PUBLISHED human-reviewed beats any draft (collegedata producer precedence pattern).
- `RequirementNode` (tree, one table): `setId`, `parentId`, `order`, `kind` (ALL_OF, ANY_OF, N_OF with `n`, SUBJECT, OVERALL, TEST, ENGLISH, STREAM, NOTE), `strength` (REQUIRED or RECOMMENDED), `canonicalSubjectId`, `minQualificationId` or `minLevelRank`, `minGradeStepId` or `minNumeric`, `testKind`, `alternatives` (for ENGLISH and TEST), `labelEn`, `labelAr`. ONE_OF is ANY_OF; TWO_OF is N_OF with n=2. NOTE nodes hold text we cannot evaluate and always return `unknown`, so nothing silently passes.
- `RequirementEvidence`: `nodeId`, `sourceSnapshotId`, `evidenceText` (verbatim substring of the snapshot text, validated on save), `locator` (URL plus heading or page), `extractedBy`, `confirmedById`. Every node needs at least one evidence row before its set can be PUBLISHED.

Ingestion pipeline
- `RequirementSource` (global): `programId` or `universityId`, `url`, `kind` (OFFICIAL_UNIVERSITY, OFFICIAL_BODY such as UCAS, MIRROR, MANUAL; mirrors never override official, following `source_provenance`), `lastCheckedAt`, `lastVerifiedAt`, `removedAt`, `checkIntervalDays`.
- `SourceSnapshot`: `sourceId`, `sha256` of normalized text, `rawSha256`, `r2Key` (content-addressed, `sources/{sourceId}/{sha256}.html`), `finalUrl`, `httpLastModified`, `fetchedAt`, `extractStatus`. Fetch outcomes follow collegedata's branches: INSERTED, UNCHANGED_VERIFIED, UNCHANGED_REPAIRED, REFRESHED, MARKED_REMOVED.
- `ExtractionRun`: `snapshotId`, `model`, `promptVersion`, `schemaVersion`, `status` (OK, VALIDATION_FAILED, SKIPPED), `acceptedCount`, `rejected Json` (reason per field), unique on (snapshot sha256, schemaVersion, model, promptVersion) so a rerun on the same bytes is a cache hit (the `cds_llm_cache` key pattern, which also satisfies our idempotency rule 9).
- `RequirementChange`: `programId`, `fromSetId`, `toSetId`, `nodeKey`, `eventType` (ADDED, REMOVED, THRESHOLD_RAISED, THRESHOLD_LOWERED, STRENGTH_CHANGED, SOURCE_CHANGED, SOURCE_REMOVED), `severity` (WATCH, NOTABLE, MAJOR), `verificationStatus`, `visibleToStudents` default false, `reviewedById`. Affected students are only notified after review.

Tracker and deadlines
- `ApplicationDeadline` (global or tenant): `programId` or `universityId`, `cycle`, `round` (UCAS_EQUAL, OXBRIDGE_MEDICINE, ED, ED2, EA, REA, RD, ROLLING, UNIFIED, DIRECT), `date`, `source` (OFFICIAL, CDS, ROUND_DEFAULT, MANUAL) and `sourceSnapshotId`. ROUND_DEFAULT rows are shown as "confirm with the university" (college-tools label pattern).
- Extend `ShortlistEntry` with `round`, `cycle`, and `ApplicationTask` rows generated from templates (template id, scope, anchor, offset, owner role, status, locked flags, evidence source) instead of the fixed `CHECKLIST`.
- `CoursePlan` and `CoursePlanItem` (tenant): `studentId`, `grade` (9 to 12), `term`, `schoolCourseOfferingId`, `status` (PLANNED, ENROLLED, COMPLETED, DROPPED), `source` (COUNSELOR, STUDENT, IMPORT).
- Scorecard: add typed columns (or a `UsInstitutionStats` table keyed by `scorecardId`) for SAT/ACT percentiles, cost, net price, retention, completion, earnings, test requirement, ownership and locale, instead of the snapshot-only read in `us-data.ts`. Record `dataYear` and `fetchedAt` for provenance.

### B. Algorithms to adopt

1. Requirement tree evaluation (pattern from surriculum `requirement-engine.js` and `expression-policy.js`, reimplemented because it is GPL). Evaluate recursively with three-valued logic: ALL_OF is not_met if any required child is not_met, unknown if any is unknown, else met; ANY_OF is met if any child is met, unknown if none met and any unknown, else not_met; N_OF counts met children against n and treats unknown children as "could still be met". Return progress rows `{ nodeId, current, target, unit, status, provisional, unconfirmed, missing[], oneOf[][] }` like `groupProgressFor`, and keep the existing `CheckResult` fields (`classesToTake`, `scoreGaps`) as projections of the tree. RECOMMENDED nodes never count as gaps (already the rule in `checker.ts`).
2. Count once, measure many (surriculum design doc section 4). A student subject result can satisfy several nodes across programs; within one requirement set, a result used for an N_OF slot must not also fill a second slot in the same N_OF. Pick the best assignment deterministically: sort candidates by grade rank, then by subject code.
3. Course unlock and what-if (pattern from `suggestion-candidate-impact.js` and `suggestion-ranking.js`). For each offering not in the plan and allowed by grade and prerequisites, add it to a copy of the plan, re-evaluate every shortlisted program, and report nodes that move from not_met to met or unknown. Rank by programs unlocked, REQUIRED over RECOMMENDED, then by how many shortlisted programs benefit. Show the score breakdown, not only a number. Grade what-ifs ("if Maths reaches A") reuse the same evaluator with an overridden result row.
4. Planner constraints. Prerequisites use strictly earlier terms, with explicit concurrent clauses only; completed but failed courses do not count; warnings are advisory with a reason and never silently drop a course (surriculum README semantics). Offering-history tags ("not offered in Grade 11 last two years") come from the school's own catalog history.
5. Ingestion with hashing (collegedata `archive.ts`). Fetch, normalize (strip scripts, nav and dynamic tokens) before hashing so cosmetic changes do not trigger extraction; store raw bytes in R2 by SHA; take the insert, unchanged, repaired or refreshed branch; update the source row before inserting the snapshot so a crash is repaired on the next run.
6. LLM extraction as a validated draft (collegedata `tier4_llm_fallback.py` `validate_response`, MIT, port to TypeScript). All calls go through `src/server/ai/provider.ts`. Reject any node whose `evidenceText` is not a verbatim substring (exact, then whitespace-collapsed) of the snapshot text, whose value does not appear in its evidence, whose subject or test code is outside our vocabulary, or whose numbers fail range checks (IELTS 0 to 9, IB 24 to 45, percentages 0 to 100). Never overwrite a human-entered value. Output is always a DRAFT set that a person reviews before PUBLISHED.
7. Change detection (collegedata `project_change_events.py`). Diff the newly published set against the previous one per node key; thresholds raised or lowered, nodes added or removed, and a source that disappears become events. Cap severity when the source kind changed. Hide from students until reviewed. Use `sha256(parts).slice(0, 32)` event IDs so reruns are idempotent.
8. Scorecard mapping (college-tools `src/config.js` `API_FIELDS` and `src/colleges.js`, collegedata `tools/scorecard/refresh_summary.py`; both MIT). Add the missing fields to `SCORECARD_FIELDS`, port `testOptionalFromRequirement_`, `campusSettingFromLocale_` and `typeFromOwnership`, add retry with exponential backoff on 5xx and 429, and add a drift guard that fails the import when an expected field is absent from every row of the first page.
9. US positioning (collegedata `positioning.ts`, MIT). Use `interpolatePercentile`, the caveats list, and the under-15-percent suppression to refine `categoryFor` for US programs, keeping our rule that an unmet listed requirement always means REACH.
10. Deadline engine (college-tools `task-planner.js`, MIT). Resolve each deadline with `{date, source}`; fall back to round defaults labeled as needing confirmation; classify urgency with the 14, 30 and 90 day buckets; compress late starts proportionally; align tasks after their dependencies; on regeneration keep completed tasks, notes, locked owners and locked dates, and archive tasks that no longer apply with a reason. Jobs run in the worker with idempotency keys per (entry, template, cycle).

### C. What to avoid

- LLM answers about eligibility (AGENTIC-RAG): the verifier there never sees the retrieved text and its sample outputs are wrong. Eligibility is always computed by the deterministic evaluator.
- Program-specific rules hard-coded in TypeScript. surriculum's own design doc records the cost of that and moved the rules into data.
- Free-text requirements as the only representation (Math-Student-Launchpad `entryRequirements`). Free text is allowed only as NOTE nodes that evaluate to unknown.
- Name matching as identity. college-tools migrated to stable IDs; our Scorecard import may keep `normName` linking only as a one-time bridge, then match by `scorecardId`.
- Unlabeled source blending. Every number shown to a student names its source and date (collegedata principle, and our existing `sourceUrl`/`lastVerifiedAt` intent).
- Positional HTML scraping without validation (applytool). Our fetcher stores the page and extracts with evidence checks; a failed validation leaves the previous published set in place.
- Regex built from user input (applytool `checkName` mode 2). Use plain substring or trigram search.
- Browser-only storage for anything the school needs (surriculum, applytool, Launchpad). All state is tenant data through `tenantDb(orgId)`.
- Cross-curriculum grade conversion tables we invent. Only use equivalences that a program or official body publishes, with evidence.

### D. Licensing constraints

- May copy with an entry in `docs/third-party.md` (source, license, what, where):
  - bolewood/collegedata-fyi code (MIT, (c) 2026 Anthony S. and Bolewood Group, LLC): `web/src/lib/positioning.ts`, `web/src/lib/freshness.ts`, logic ported from `tools/extraction_worker/tier4_llm_fallback.py`, `tools/change_intelligence/project_change_events.py`, `tools/scorecard/refresh_summary.py`, and field definitions from `schemas/cds_schema_2025_26.json` (the schema itself is derived from the CDS Initiative's public template).
  - granitehq/college-tools (MIT, (c) 2025 Granite HQ, LLC): `src/config.js` `API_FIELDS`, mapping helpers in `src/colleges.js` and `src/scorecard.js`, `src/formulas.js` `fitBand`, `src/task-planner.js` resolver, urgency, late-start, dependency and reconcile logic.
  - lashhw/applytool (MIT, (c) 2019 黃彥傑): nothing planned.
- Must not copy:
  - collegedata-fyi `data/discovery/` (CC BY-SA 4.0, share-alike).
  - BEFICENT/surriculum (GPL-3.0): patterns only, reimplemented from the behavior described above; no code, no data files.
  - AGENTIC-RAG-COURSE-PLANNING-ASSISTANT (no license file): nothing.
  - Math-Student-Launchpad (no LICENSE file; README claims MIT without a holder): treat as patterns only.
- Data sources: College Scorecard is US federal public domain data (already logged). University requirement pages are copyrighted content; we store snapshots for provenance and review, show short verbatim evidence quotes with a link to the official page, and do not republish full pages.
