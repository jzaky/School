# Topic policies (draft)

Short rules that support `INFORMATION_SECURITY_POLICY.md`. Each applies to everyone working for
Nexus AI Assurance, including contractors.

## Access control

- Every person and every system has its own account. No shared logins.
- MFA on every company account that supports it; a hardware key for the code host and cloud consoles.
- Access is granted for a need and removed when the need ends. The security lead reviews company
  accounts every quarter and records the review.
- Production and customer environments are reached only through named accounts, never with the
  database owner credential except for migrations.

## Acceptable use

- Company devices and accounts are for company work. Do not install unapproved software on devices
  that hold customer data.
- Never paste secrets, customer data or personal data into public tools, chat services or AI tools
  that are not approved for that data.
- Use synthetic data for development, tests and demonstrations.

## Classification and handling

| Class | Examples | Handling |
|---|---|---|
| Public | Website, published documents | No restriction |
| Internal | Plans, internal docs, source code | Company accounts only |
| Confidential | Customer contracts, pilot results, security findings | Named people only; encrypted in transit and at rest |
| Restricted | Customer data, secrets and keys | Only where a customer agreement requires it; never on personal devices; never in source control |

Transfers of Confidential or Restricted information use encrypted channels and go only to recipients
with a need.

## Suppliers

- Keep a supplier list: what each supplier does, what data it holds, its security assurances
  (certifications, reports), and the contract's security terms.
- Review each supplier that holds Confidential or Restricted information once a year.
- Current suppliers to record: code hosting and CI, cloud hosting, email delivery, domain and DNS,
  payment test sandboxes, the AI coding assistant.

## Incidents

1. Anyone who suspects an incident tells the security lead at once.
2. The security lead records it, contains it (rotate keys, pause agents, suspend access), and decides
   who must be told.
3. Affected customers are informed without undue delay and within any contractual deadline;
   authorities are informed where the law requires.
4. After closure, a short review records the cause, what changed and what was learned.
5. Run one practice exercise a year and record it.

## Continuity

- AEGIS fails closed: if it cannot decide, agent actions do not run.
- Backups of hosted environments are taken daily and a restore is tested every quarter
  (`../BACKUP_RECOVERY.md`).
- Installation and recovery are scripted so another engineer can follow them
  (`../OFFLINE_INSTALL.md`, `../DEPLOYMENT.md`).

## Remote and mobile work

- Laptops: full-disk encryption, automatic screen lock, current security updates, firewall on.
- No customer data on removable media.
- Lock the screen when away; do not work on Confidential information where others can see it.
- Lost or stolen device: report immediately; revoke its sessions and keys.

## People

- Before joining: proportionate background check; signed agreement with confidentiality and security
  clauses; NDA where needed.
- On joining: security briefing on these policies; record it.
- On leaving or changing role: remove access the same day, collect devices, remind of continuing
  confidentiality duties.

## Secure development

- All code in version control; every change runs the CI gates (tests, lint, type checks, dependency
  audit, image scan, secret scan) and must pass before release.
- Security-sensitive changes (authentication, authorization, cryptography, evidence, tenant isolation)
  get an explicit security review and a regression test.
- Third-party code is used only under a compatible licence and recorded in `../THIRD_PARTY.md`.
- Code written with an AI coding assistant is held to the same gates and review as any other code.
