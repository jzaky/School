# Live validation with real-world data

The impact test (`docs/IMPACT.md`) uses synthetic cases against a simulated system. This run uses only
real data, fetched live: real npm packages, the live OSV.dev advisory database, and a public dataset of
real prompt-injection attempts.

- Run: `pnpm --filter @aegis/core live` (needs outbound access to registry.npmjs.org, api.osv.dev and
  datasets-server.huggingface.co; behind a proxy, set `NODE_USE_ENV_PROXY=1`)
- Code: `packages/core/scripts/live-validation.ts`
- Latest results: `docs/validation/results/LIVE_RESULTS.md` and `LIVE_RESULTS.json`

## What it does

1. **Real packages, live advisories.** Ten real npm package versions, including four that were really
   compromised (postmark-mcp 1.0.16, event-stream 3.3.6, ua-parser-js 0.7.29, node-ipc 10.1.1), go
   through AEGIS Software Security with their real license and integrity hash from the npm registry and
   live OSV.dev lookups. Each result is compared with the public record of that version.
2. **Real attack text.** All 662 rows of deepset/prompt-injections (Apache-2.0) go through the AEGIS
   injection detector as tool parameter content. The report gives what was caught and what was wrongly
   flagged, for all rows and for the held-out test split.

Each run uses a fresh organization, so results reflect only that day's data.

## What the first run found, and what changed

| | First live run | After the fixes |
|---|---|---|
| postmark-mcp 1.0.16 (OSV MAL-2025-47604) | approved: the malicious-package record carries no severity and was read as medium | prohibited |
| Compromised packages blocked outright | 0 of 4 | 4 of 4 |
| Real injection attempts caught, held-out split | not measured | 18 of 60 (30%), 0 of 56 ordinary texts flagged |
| Real injection attempts caught, all rows | 12 of 263 (4.6%) | 104 of 263 (39.5%), 2 of 399 ordinary texts flagged |

Fixes: OSV malicious-package records and advisories that describe malware or a backdoor are now a
`malicious` finding that prohibits the software (regression test in `tests/software-security.test.ts`);
the injection detector gained general reset and persona patterns in English, German and French, written
from the dataset's train split only, with the test split held out.

## Reading it honestly

The injection detector is a fast pattern check and one layer among several. Policies, approvals, data
protection, payment matching and the other controls still decide what an agent may do when an attack is
missed. This dataset is largely chatbot jailbreaks (role play, opinions, German text), not agent actions,
so it is a hard test for a detector built around agent actions; the figures are reported as measured.
