# Static analysis (SAST)

`.github/workflows/sast.yml` scans the whole repository (the school app, AEGIS, scripts and workflows) on every
push, every pull request, weekly and on demand. It has no path filters, so it always runs.

## What runs

| Job | Tool | Covers |
| --- | --- | --- |
| CodeQL (javascript-typescript, python, actions) | GitHub CodeQL, `security-extended` queries, `.github/codeql/codeql-config.yml` | TypeScript and JavaScript, the Python SDK and scripts, GitHub Actions workflows |
| Semgrep | Semgrep 1.183.0 (pinned), rulesets `p/typescript`, `p/javascript`, `p/nodejs`, `p/react`, `p/python`, `p/github-actions` | The same code from a second engine; workflow shell injection and unpinned actions |
| SAST gate self-test | `node --test .github/scripts/sast-gate.test.mjs` | The gate itself |
| SAST gate | Summary job | Fails unless every job above ran and passed |

Results from both tools are uploaded to GitHub code scanning (Security tab). Dependency scanning (`pnpm audit`),
container scanning (Trivy) and secret scanning (Gitleaks) stay in `aegis-ci.yml` and are not repeated here.

## What blocks

`.github/scripts/sast-gate.mjs` reads each tool's SARIF output and fails the job when:

- any high or critical finding is not in the reviewed baseline. High or critical means a CodeQL rule with
  security-severity 7.0 or above, or a Semgrep result at ERROR level. On pull requests Semgrep reports only
  findings the change introduces (`--baseline-commit`);
- a results file is missing or unreadable, has no runs, or reports a failed tool execution. A scan that did not
  really run never passes as "no findings".

The `SAST gate` job fails unless CodeQL, Semgrep and the gate self-test all succeeded, so a cancelled, skipped
or failed scan cannot count as clean. Every action is pinned to a commit SHA.

**Owner action needed:** to make this block merges, add `SAST gate` as a required status check in the branch
protection rules (or a ruleset) for the default branch. That is a repository setting and cannot be set from the
code.

## Reviewed false positives

Two ways, both reviewed in the pull request that adds them:

- **In source (preferred).** A `// codeql[rule-id] reason` comment on the line before the finding. The CodeQL
  job runs the alert-suppression query, so the result is uploaded as suppressed and GitHub shows it as
  dismissed. The gate accepts suppressions in source but not ones marked under review or rejected. Current
  suppressions (2026-10-31):
  - `js/insufficient-password-hash` on `tokenDigest` and `tokenMac` (`aegis/packages/core/src/lib/crypto.ts`):
    SHA-256 and HMAC over 256-bit random API keys and session tokens. Passwords use argon2id.
  - The same rule on the evidence hash chain (`aegis/packages/core/src/evidence/ledger.ts`): CodeQL follows an
    API key's public prefix into evidence records. No record holds a secret.
  - `js/file-access-to-http` and `js/http-to-file-access` in three developer scripts and the live validation
    script, which send local test keys to the API under test or write a results report.
- **The baseline.** `.github/sast-baseline.json` lists reviewed false positives by tool, rule and file, with
  the reason. It is used for the school application, whose files this program does not otherwise change.
  Entries (2026-10-31):
  - `js/insufficient-password-hash` on `src/server/integrations/key-format.ts` and
    `src/server/imports/classes.ts`: SHA-256 over a random API key, or over a non-secret class code.
  - `js/biased-cryptographic-random` on `src/lib/signup.ts` and `src/server/groups/codes.ts`: the alphabet has
    32 characters and 256 is divisible by 32, so `byte % 32` is uniform.

GitHub's own CodeQL check on pull requests reports new alerts in changed code. A finding suppressed in source
does not count there; one only in the baseline does, so the school application entries stay in the baseline only
while that code is unchanged.

## Fixed when SAST was introduced

The first scans found real issues, all fixed with tests where code was involved:

- AES-GCM decryption without a fixed tag length (AEGIS secrets, school app fields, research script): a truncated
  tag could be accepted. Now `authTagLength: 16` (`packages/core/tests/crypto.test.ts`).
- Shell injection in three non-AEGIS workflows (`research-discover`, `research-fetch`, `voiceover`): inputs were
  pasted into commands. They now reach the shell as environment variables, and Python reads them from the
  environment.
- Regular expressions that could take quadratic time on crafted input (trailing-slash and padding trims, a
  licence-expression split, receipt total and tax-number patterns, an Entra error match). Replaced with
  linear-time code (`trimTrailing`, a token-based licence parser) or unambiguous patterns, with timing tests.
- An unescaped value in a regular expression (school catalog validation), an organization id used as a file
  path with a weak check (school document storage, now an allowlist plus a resolved-path containment check), an
  `@` encoding that replaced only the first occurrence, check-then-write races in two scripts, and unanchored
  URL patterns in two test scripts.
- Every remaining GitHub Action across all workflows pinned to a commit SHA.

## Fixed after the first pull request scans (2026-10-31)

- Prototype pollution: a policy attribute path such as `context.__proto__.x` could write to `Object.prototype`
  when the decision context was rebuilt from a trace (`policy/boundary.ts`, regression test in
  `tests/attack-validation-regressions.test.ts`). Restriction path helpers now check each segment where it is
  used.
- A migration name passed to the migration script went through a shell; it is now an argument list.
- Every workflow sets a read-only `GITHUB_TOKEN` (`permissions: contents: read`) unless a job needs more.
