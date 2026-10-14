# Open-source and third-party software security (Secure S4)

**Status:** implemented and tested with synthetic SBOMs and scanner reports. The tests run against a stand-in for OSV.dev. No real scanner output and no real osv.dev query have been used yet.

A clean assessment means these checks found no known problem. It does not mean the software is safe, and the console says so wherever a score appears.

## The workflow

1. **Request.** Anyone in the organization asks to use a package or an application. They give the ecosystem, the exact version and the purpose. With no inventory yet, the request starts **under review**.
2. **Evidence.** The security team attaches files to the request. Each file is reduced to components and findings, and then discarded.

   | File | Formats | Typical source |
   |---|---|---|
   | Software bill of materials (SBOM) | CycloneDX JSON | Syft, Trivy, cdxgen |
   | SBOM | SPDX JSON | |
   | Dependency lockfile | npm `package-lock.json`, versions 2 and 3 | npm. Records where each package was downloaded from, whether it has an integrity hash, and whether it runs install scripts. |
   | Vulnerability report | JSON | Grype |
   | Vulnerability and secret report | JSON | Trivy |
   | Secret report | JSON | Gitleaks. Only the rule and the file location are kept. The secret value and the matched text are never stored. |
   | Maintenance signals | JSON | OpenSSF Scorecard. Checks scoring 3 or below become findings. |

3. **Checks AEGIS runs itself.** These are deterministic and run locally:
   - **Typosquatting.** The name is one edit away from a popular npm or PyPI package, or differs only by separators. The popular list is short and deliberately incomplete.
   - **Dependency confusion.** A package with one of the organization's internal name prefixes was downloaded from somewhere other than an internal registry host.
   - **Install scripts.** The package runs code when it is installed.
   - **Missing integrity hashes.** The lockfile has no hash to check the download against.
   - **Licenses,** checked against the license policy (allowed, review, prohibited). SPDX expressions are understood: with `OR` the most permissive option counts, with `AND` the strictest. A missing or unlisted license is a finding.
4. **Known vulnerabilities from OSV.dev,** if the organization turns the lookup on. AEGIS then sends the names and versions of public packages to osv.dev, and nothing else. Names that match internal prefixes are never sent. The lookup is off by default.
5. **Assessment.**
   - **Score.** Each open finding adds points under a named factor with an explanation, and the total is capped at 100. Missing inventory is itself a factor: without an SBOM, the dependencies are unknown.
   - **Built-in floor:**

     | Condition | Floor |
     |---|---|
     | Typosquatting, dependency confusion or a prohibited license | prohibited |
     | A critical vulnerability or a secret | quarantined |
     | A high vulnerability or an install script | restricted |
     | Licenses to review, or no inventory | under review |

   - **Policy.** The organization's software policies (category `software`) are then evaluated by the same policy engine as everything else. They can only make the recommendation stricter than the floor, never weaker. Outcomes map as follows:

     | Policy outcome | Recommendation |
     |---|---|
     | allow | approved |
     | restrict | restricted |
     | quarantine | quarantined |
     | deny | prohibited |
     | anything else | under review |

     A policy that fails its integrity check makes the recommendation prohibited.
6. **Decision.** A person with `security:write` who is not the requester sets the status: approved, restricted, under review, quarantined or prohibited. Deciding below the recommendation needs a written reason of at least 10 characters. Automatic approval of clean recommendations exists but is off by default.
7. **Accepting a risk.** A person can accept a finding with a reason. It stays on record and stops counting toward the score.
8. **Reassessment.** Every new piece of evidence reassesses the software. If software that has already been decided now assesses stricter than its status, AEGIS marks it "reassessment needed" and raises a security event. The status is not changed silently: a person reviews it. A daily worker job (`software.advisories`) asks OSV.dev again about approved and restricted software, for organizations that turned the lookup on.

Every step writes evidence: request, evidence attached, assessment, decision, accepted finding and settings change.

## Tool choices

The table covers the tools named in the directive, with license details from `docs/OPEN_SOURCE_RESEARCH.md`.

| Tool | Used for | How AEGIS uses it |
|---|---|---|
| Syft (Apache-2.0) | Generating SBOMs | Its CycloneDX or SPDX output is read |
| Grype (Apache-2.0) | Vulnerability matching on SBOMs | Its JSON output is read |
| Trivy (Apache-2.0) | Vulnerabilities, secrets, and SBOMs for containers and infrastructure as code | Its JSON output is read |
| OpenSSF Scorecard (Apache-2.0) | Maintenance and project hygiene | Its JSON output is read |
| Gitleaks (MIT) | Secret scanning | Its report is read without the secret values |
| TruffleHog (AGPL-3.0) | Secret scanning with live verification | Not used, because of its license. Gitleaks covers secret detection. |
| OSV.dev | Open vulnerability database | Optional lookup over its public API |
| Cosign (Apache-2.0) | Signature and attestation verification | Not integrated yet |
| OSSF package-analysis (Apache-2.0) | Dynamic analysis of package behaviour | Not integrated. It needs a sandbox, which belongs with S5. |

AEGIS reads the outputs of these tools rather than bundling them. They run where the customer already runs them (CI, a build host), and AEGIS stays one TypeScript service without extra binaries in its request path.

## API and console

- `/v1/software` lists and creates requests, and `/v1/software/:id/evidence` attaches files. These routes are for people only; API keys are refused.
- **Console:** Security, Software Security. It shows the list, a request dialog, the settings (internal prefixes and registry hosts, the OSV.dev lookup, automatic approval) and a detail page for each request with:
  - the assessment and its factors;
  - the findings, each with an accept button;
  - the components;
  - the attached evidence;
  - the decision form.

  The decision form is disabled for the requester, with the reason shown.
- **Plan:** included in the Secure, Enterprise and trial plans.

## Tests

- **`packages/core/tests/software-security.test.ts`** (13 tests) covers:
  - the parsers for every format;
  - license expressions;
  - typosquatting;
  - that a Gitleaks report never keeps the secret;
  - the clean-assessment wording;
  - an npm lockfile producing every local finding plus an OSV.dev advisory, with internal names never sent to OSV.dev;
  - four-eyes decisions and the written reason required below the recommendation;
  - reassessment and its security event after a new critical vulnerability;
  - accepting a risk;
  - a policy that can only make the recommendation stricter;
  - the daily refresh;
  - automatic approval;
  - the plan gate.
- **`apps/web/tests/e2e/software-security.spec.ts`** (3 tests) covers the reassessment flag, dependency confusion with a four-eyes decision, and a new request.

## Not built yet

- Signature and provenance verification. Cosign, Sigstore attestations and SLSA provenance are not checked.
- Behavioural or malware analysis. AEGIS does not run packages.
- Running Syft, Grype or Trivy inside AEGIS. Their output is imported instead.
- Registry metadata such as publish dates, maintainers and download counts, for judging age and maintenance. Scorecard covers part of this.
- Inventory of installed applications, browser extensions and developer tools across devices. Requests cover what people ask for, and Shadow AI discovery covers AI applications seen in logs.
- Lockfiles other than npm (`poetry.lock`, `go.sum` and others). An SBOM covers them in the meantime.
