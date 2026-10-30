# Shadow AI discovery (Secure S3)

Status: implemented and tested with synthetic log exports. No customer log has been imported, and no live connection to an identity provider, browser, endpoint or network product exists. Imports are file exports or API posts that the organization makes itself.

## What it answers

- Which AI applications people in the organization use.
- Whether each one is approved, tolerated, unapproved or not yet reviewed.
- Which work accounts and managed devices are involved, when the source identifies them reliably.
- How sure AEGIS is, for each app.
- Which uses break the organization's decision (an unapproved app in use).
- What the sources cannot see.

## Sources and how sure each one is

| Source | Format AEGIS reads | Confidence | Sees | Does not see |
|---|---|---|---|---|
| Microsoft Entra ID sign-in logs | Graph `signIn` JSON export (`createdDateTime`, `userPrincipalName`, `appDisplayName`, `status.errorCode`) | Confirmed | Successful work-account sign-ins to SSO-connected apps | Personal accounts, apps outside SSO, anything typed |
| Okta System Log | JSON events (`published`, `actor.alternateId`, `target[AppInstance].displayName`, `outcome.result`) | Confirmed | SSO to apps assigned in Okta | Same as above |
| Managed browser telemetry | JSON lines (`ts`, `url` or `domain`, `user`, `device`) | Observed | AI sites visited in the managed browser | Other browsers, personal devices |
| Endpoint security | JSON lines (`ts`, `process`, `hostname`, `user`) | Observed | AI desktop apps and local model runtimes (Ollama, LM Studio, llama.cpp) | Unmanaged devices, what was asked |
| Secure web gateway or proxy | JSON lines (`ts`, `url`, `user`) | Observed | Requests to AI sites through the proxy | Traffic that bypasses it; encrypted contents unless TLS inspection is on |
| CASB | Same shape as the proxy | Observed | Cloud AI apps it recognizes | Apps it does not recognize |
| DNS logs | JSON lines, including Zeek `dns.log` in JSON (`ts`, `client` or `id.orig_h`, `query`) | Inferred | Lookups of AI hostnames by device address | Who, whether the app was actually used, anything typed; encrypted DNS bypasses it |
| SaaS inventory | JSON (`app`, `user`, `lastSeen`) | Inferred | Apps connected or found in reviews | Whether and how often they are used |
| AEGIS AI gateway | Its own records | Confirmed | Every request sent through it, with data classes | Nothing outside it |

**Confidence levels:**
- **Confirmed** means an authenticated sign-in or an AEGIS record.
- **Observed** means a managed sensor saw the app in use.
- **Inferred** means metadata suggests use.

The console shows the strongest level per app and explains each level.

None of these sources reveals prompt contents, and AEGIS never says it does. Network metadata shows that a hostname was looked up or reached, not what was sent. Only the AI gateway sees content, and only for requests sent through it.

## Privacy by construction

- **Only AI matches are stored.** Every other line in a log is discarded while it is read. A DNS import therefore does not copy anyone's browsing history into AEGIS. Device addresses from non-AI lines are not kept.
- **Unknown identities are fingerprinted.** Identities that match a member are linked to that member. Others (contractors, people outside the organization) are stored only as a keyed fingerprint. Device identifiers are fingerprinted the same way.
- **Hints are app names only.** Sign-in and inventory logs list app names that AEGIS did not recognize (for example "Workday"). Up to 20 of those names are kept, so an administrator can add any that are AI tools. Unmatched hostnames from network logs are never kept.
- **Files are not stored.** Imports record counts: read, matched, new, already imported, discarded, unreadable.
- **Re-importing is safe.** Each signal has a dedupe key (source, app, person, device, minute), so the same export can be imported twice without double counting.

## Decisions, findings and events

Each app in the catalog, and each custom app, has a decision:

- **approved**
- **tolerated**
- **unapproved**
- **not reviewed** (default)

The decision can include the controls the organization says it has in place: single sign-on, a signed data processing agreement, agreed retention terms, administration of the workspace. These are the organization's statements, recorded as such.

**Findings:**
- An unapproved app with signals in the window is a **policy violation**.
- An unreviewed app with signals **needs review**.

Each import that contains signals for an unapproved app raises one security event (`shadow_ai.unapproved_use`). Its title states the confidence: "Possible use" for inferred, "Observed use", or "Confirmed use". Its detail records `blocked: false`. Discovery never blocks and never says it did. Blocking happens at the AI gateway for traffic sent through it.

## Coverage

The coverage panel lists every kind of source with what it sees and misses, and when it was last imported. It also states:

- how many of the five kinds of source (identity, browser, endpoint, network, inventory) sent data in the last 30 days;
- which kinds are missing;
- for identity sources, how many active members appear in sign-in logs.

There is no "percent of AI use found" figure, because that cannot be known.

## API

`POST /v1/shadow-ai/imports` with `{ format, text, label? }`. The caller needs either:
- an integration key with the `discovery:report` scope (a log forwarder), or
- a signed-in person with `security:write`.

Agent keys are refused. Results (`/apps`, `/coverage`, `/imports`) are read in the console with a session, not with API keys. The feature is part of the Secure, Enterprise and trial plans.

## Catalog

The built-in catalog covers:

| Category | Apps |
|---|---|
| Chat | ChatGPT, Claude, Gemini, Microsoft Copilot, DeepSeek, Mistral (Le Chat), Grok, Poe |
| Search | Perplexity |
| Model APIs | OpenAI API, Anthropic API, Google AI Studio and the Gemini API |
| Coding | GitHub Copilot, Cursor |
| Platforms | Hugging Face |
| Local runtimes | Ollama, LM Studio, llama.cpp |

Each entry lists hostnames, the names identity providers use for it, and process names. Organizations add their own apps (an internal tool calling an AI API, a niche vendor) with hostnames or process names. Catalog hostnames match their subdomains, never lookalikes (`notclaude.ai` does not match `claude.ai`).

## Tests

- `packages/core/tests/shadow-ai.test.ts` (12):
  - parsing of each format, including failed sign-ins, which are skipped, and unreadable lines, which are counted;
  - subdomain matching;
  - member linking and fingerprinting;
  - that non-AI hostnames and their device addresses are not stored;
  - idempotent re-import;
  - confidence labels per source;
  - the security event for an unapproved app, saying inferred and not blocked;
  - custom apps;
  - per-app views and findings;
  - coverage statements;
  - permissions.
- `apps/api/tests/shadow-ai-api.test.ts` (3): the forwarder import, and refusal of keys without the scope and of agent keys.
- `apps/web/tests/e2e/shadow-ai.spec.ts` (3): the page on a production build, a file import, and the viewer's disabled controls.

## Not built yet

- **Live connectors.** There are no live pulls from Microsoft Graph, the Okta API, browser management consoles, EDR products, proxies or CASBs. Each needs the customer's authorization and credentials. Exports and the API post cover the same data in the meantime.
- **Browser extension.** AEGIS ships no browser extension or endpoint agent. Covert monitoring, webcam or microphone capture, and capture of personal account credentials are out of scope by design.
- **Linking network evidence to people.** Joining DNS client addresses to people through DHCP leases is not implemented, so DNS evidence stays at device level.
- **Sensitive data per app.** Whether sensitive data was involved is known only for traffic through the AI gateway. For other sources the console says nothing about content.
