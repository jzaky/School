# Statement of Applicability (draft)

Nexus AI Assurance, ISMS for the development and operation of AEGIS. Draft for management approval; see `ISMS_SCOPE.md`.

Control identifiers follow ISO/IEC 27001:2022 Annex A. Titles are short AEGIS topic names, not the text of the standard; work from a licensed copy of the standard when implementing.

Status: **In place** means implemented with evidence in the repository; **Partly in place** means designed or built but missing an operating record or approval; **To do** means not started; **Inherited** means provided by a supplier whose assurance must be recorded.

## Summary

All 93 controls are applicable.
- In place: 30
- Partly in place: 30
- To do: 22
- Inherited: 11

No control is excluded. Physical controls are applicable and inherited from the hosting provider, because the company holds no production systems on its own premises.

## Controls

| Control | Topic | Applicable | Status | How, or what remains |
|---|---|---|---|---|
| A.5.1 | Information security policies | Yes | Partly in place | Information security policy drafted (INFORMATION_SECURITY_POLICY.md); needs management approval and an annual review record. |
| A.5.2 | Security roles and responsibilities | Yes | Partly in place | Roles named in ISMS_SCOPE.md; product roles and permissions in packages/core (RBAC). Assign a security lead when the first hire joins. |
| A.5.3 | Segregation of duties | Yes | In place | Product enforces separation of duties on approvals; repository changes go through review and CI. |
| A.5.4 | Management responsibilities | Yes | To do | Founder signs the policy and runs the first management review (RECORDS_CHECKLIST.md). |
| A.5.5 | Contact with authorities | Yes | To do | List the regulators and authorities to contact (UAE Cyber Security Council, TDRA, data protection authority) and when. |
| A.5.6 | Contact with special interest groups | Yes | To do | Join relevant security groups and record membership. |
| A.5.7 | Threat intelligence | Yes | Partly in place | OSV advisories and CI dependency audit (pnpm audit, Trivy); add a regular review of AI-agent attack techniques. |
| A.5.8 | Security in project management | Yes | Partly in place | Threat model and security review per phase (docs/THREAT_MODEL.md); make the security checklist part of every project. |
| A.5.9 | Inventory of information and assets | Yes | Partly in place | Product inventories agents and tools; keep a company asset register (laptops, accounts, cloud resources). |
| A.5.10 | Acceptable use of assets | Yes | To do | Acceptable use rules in TOPIC_POLICIES.md; staff acknowledgement on joining. |
| A.5.11 | Return of assets | Yes | To do | Leaver checklist in TOPIC_POLICIES.md. |
| A.5.12 | Classification of information | Yes | Partly in place | Product data classes and classification limits; company classification scheme in TOPIC_POLICIES.md. |
| A.5.13 | Labelling of information | Yes | To do | Label documents by classification in headers and file names. |
| A.5.14 | Information transfer | Yes | Partly in place | Product egress and destination controls; company transfer rules in TOPIC_POLICIES.md. |
| A.5.15 | Access control rules | Yes | In place | Least-privilege roles, row-level security per tenant, application role cannot bypass it (packages/db tests). |
| A.5.16 | Identity management | Yes | In place | Unique identities for people and agents; SSO (OIDC, SAML), SCIM provisioning, agent identity lifecycle. |
| A.5.17 | Authentication information | Yes | In place | Password hashing, MFA, secrets sealed at rest, no credentials in the repository (Gitleaks in CI). |
| A.5.18 | Access rights | Yes | Partly in place | Product access reviews exist; run and record quarterly reviews of company accounts. |
| A.5.19 | Security in supplier relationships | Yes | Partly in place | Supplier list and risk notes in TOPIC_POLICIES.md; product integration security checks. |
| A.5.20 | Security in supplier agreements | Yes | To do | Security terms in supplier contracts (hosting, email, payment). |
| A.5.21 | ICT supply chain security | Yes | In place | Pinned dependencies, lockfile, dependency audit and image scanning block releases in CI; third-party code logged in docs/THIRD_PARTY.md. |
| A.5.22 | Monitoring and review of supplier services | Yes | To do | Annual review of each supplier's security reports. |
| A.5.23 | Security of cloud services | Yes | Partly in place | Deployment options and residency checks (docs/DEPLOYMENT_OPTIONS.md); record the chosen cloud provider's assurances. |
| A.5.24 | Incident management planning | Yes | Partly in place | Incident handling in the product; company incident procedure in TOPIC_POLICIES.md. |
| A.5.25 | Assessment of security events | Yes | In place | Security events are graded by severity and raised automatically in the product. |
| A.5.26 | Response to incidents | Yes | Partly in place | Containment responses in the product; company response steps in TOPIC_POLICIES.md; run one exercise. |
| A.5.27 | Learning from incidents | Yes | To do | Post-incident review template; record lessons from the first exercise. |
| A.5.28 | Collection of evidence | Yes | In place | Hash-chained, signed evidence ledger with independent verification (docs/adr/0004-evidence-integrity.md). |
| A.5.29 | Security during disruption | Yes | Partly in place | Fail-closed gateway and pause controls; continuity plan in TOPIC_POLICIES.md. |
| A.5.30 | ICT readiness for business continuity | Yes | Partly in place | Backup and restore drill (docs/BACKUP_RECOVERY.md); test and record recovery time. |
| A.5.31 | Legal, statutory, regulatory and contractual requirements | Yes | Partly in place | Framework catalogs map obligations; keep a company register of legal and contractual requirements. |
| A.5.32 | Intellectual property rights | Yes | In place | Licences of reused code recorded (docs/THIRD_PARTY.md, docs/PROVENANCE.md); copyrighted standards summarised, not copied. |
| A.5.33 | Protection of records | Yes | In place | Evidence ledger is append-only and verifiable; repository history retained. |
| A.5.34 | Privacy and protection of PII | Yes | Partly in place | Product data protection (masking, egress blocking, UAE PDPL catalog); company privacy notice and records of processing. |
| A.5.35 | Independent review of information security | Yes | To do | Independent review: external penetration test (docs/PENTEST_RFQ.md) and the certification audit. |
| A.5.36 | Compliance with policies and standards | Yes | To do | Internal audit against this pack before Stage 1 (RECORDS_CHECKLIST.md). |
| A.5.37 | Documented operating procedures | Yes | Partly in place | Operating procedures for install, backup and deployment (docs/OFFLINE_INSTALL.md, docs/DEPLOYMENT.md). |
| A.6.1 | Screening | Yes | To do | Background checks for each hire, proportionate to access. |
| A.6.2 | Terms and conditions of employment | Yes | To do | Security clauses in employment and contractor agreements. |
| A.6.3 | Security awareness, education and training | Yes | To do | Onboarding security briefing and yearly refresher; record attendance. |
| A.6.4 | Disciplinary process | Yes | To do | Disciplinary process reference in the employment terms. |
| A.6.5 | Responsibilities after termination or change | Yes | To do | Confidentiality duties continue after leaving; leaver checklist. |
| A.6.6 | Confidentiality or non-disclosure agreements | Yes | To do | NDA template for staff, contractors and pilot customers. |
| A.6.7 | Remote working | Yes | Partly in place | Remote work rules in TOPIC_POLICIES.md (encrypted laptops, screen lock, no public sharing). |
| A.6.8 | Security event reporting | Yes | Partly in place | Product raises security events; staff report suspected incidents to the security lead (TOPIC_POLICIES.md). |
| A.7.1 | Physical security perimeters | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.2 | Physical entry | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.3 | Securing offices, rooms and facilities | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.4 | Physical security monitoring | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.5 | Protection against physical and environmental threats | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.6 | Working in secure areas | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.7 | Clear desk and clear screen | Yes | To do | Clear desk and screen lock rules for home and office work (TOPIC_POLICIES.md). |
| A.7.8 | Equipment siting and protection | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.9 | Security of assets off-premises | Yes | Partly in place | Laptops encrypted and locked; rules for travel in TOPIC_POLICIES.md. |
| A.7.10 | Storage media | Yes | To do | No removable media for customer data; rule in TOPIC_POLICIES.md. |
| A.7.11 | Supporting utilities | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.12 | Cabling security | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.13 | Equipment maintenance | Yes | Inherited | No company premises hold production systems; data centre controls are inherited from the hosting provider (record its certifications). For customer on-premises installs, the customer's physical controls apply. |
| A.7.14 | Secure disposal or re-use of equipment | Yes | To do | Wipe devices before disposal or reuse; record it. |
| A.8.1 | User endpoint devices | Yes | Partly in place | Encrypted, patched, screen-locked laptops; record each device in the asset register. |
| A.8.2 | Privileged access rights | Yes | In place | Owner role separated from the application role; migrations only with the owner credential; privileged product roles limited. |
| A.8.3 | Information access restriction | Yes | In place | Row-level security, per-agent tool and resource permissions, data classification limits. |
| A.8.4 | Access to source code | Yes | Partly in place | Private repository; review access quarterly and enforce MFA on the code host. |
| A.8.5 | Secure authentication | Yes | In place | MFA, SSO, signed sessions, rate limits on sign-in. |
| A.8.6 | Capacity management | Yes | Partly in place | Rate limits, backpressure and capacity benchmarks (docs/PERFORMANCE.md); monitor in production. |
| A.8.7 | Protection against malware | Yes | Partly in place | Images scanned in CI; endpoint protection on company laptops. |
| A.8.8 | Management of technical vulnerabilities | Yes | In place | Dependency audit, Trivy image scan and secret scan block releases in CI. |
| A.8.9 | Configuration management | Yes | In place | Infrastructure as code (deploy/), pinned versions, configuration validated at start-up. |
| A.8.10 | Information deletion | Yes | Partly in place | Tenant deletion paths exist; define and test retention and deletion periods. |
| A.8.11 | Data masking | Yes | In place | Shield masks sensitive data classes in agent requests. |
| A.8.12 | Data leakage prevention | Yes | In place | Egress allowlists, destination checks and data class blocking in the gateway. |
| A.8.13 | Information backup | Yes | Partly in place | Backup procedure and restore drill script; schedule and record backups in production. |
| A.8.14 | Redundancy of facilities | Yes | To do | Decide the redundancy target per deployment model and record it. |
| A.8.15 | Logging | Yes | In place | Structured logs and the evidence ledger; personal data kept out of logs. |
| A.8.16 | Monitoring activities | Yes | In place | Deterministic monitoring rules, alerts and OpenTelemetry export. |
| A.8.17 | Clock synchronisation | Yes | Inherited | Host and container clocks synchronised by the platform; ledger timestamps from the database. |
| A.8.18 | Use of privileged utility programs | Yes | Partly in place | No privileged utilities in images (npm removed, non-root user); document admin tooling. |
| A.8.19 | Installation of software on operational systems | Yes | In place | Software changes only through CI-built images; offline bundles are checksum-verified before install. |
| A.8.20 | Networks security | Yes | In place | Network policies (deploy/k8s), internal-only network for the offline install (docs/OFFLINE_INSTALL.md). |
| A.8.21 | Security of network services | Yes | Partly in place | TLS for public endpoints; record network service providers and their terms. |
| A.8.22 | Segregation of networks | Yes | In place | Database, cache and application on an internal network separated from the published edge. |
| A.8.23 | Web filtering | Yes | Partly in place | Product destination controls for agents; company web filtering is not used, justify or add. |
| A.8.24 | Use of cryptography | Yes | In place | AES-256-GCM envelopes for secrets, Ed25519 evidence signatures, key rotation, key-vault option. |
| A.8.25 | Secure development life cycle | Yes | In place | Threat model, review and blocking CI checks on every change (.github/workflows/aegis-ci.yml). |
| A.8.26 | Application security requirements | Yes | In place | Security requirements recorded per phase (docs/SECURITY.md, docs/THREAT_MODEL.md). |
| A.8.27 | Secure system architecture and engineering principles | Yes | In place | Fail-closed design, least privilege, tenant isolation (docs/adr). |
| A.8.28 | Secure coding | Yes | In place | Typed code, input validation, lint, security regression tests. |
| A.8.29 | Security testing in development and acceptance | Yes | In place | Unit, integration, browser and security regression suites run in CI; sector validation lab. |
| A.8.30 | Outsourced development | Yes | Partly in place | Code is written with an AI coding assistant under the founder's direction; every change passes CI and review. Record this arrangement and its controls. |
| A.8.31 | Separation of environments | Yes | In place | Separate development, CI and production configuration; production refuses development settings. |
| A.8.32 | Change management | Yes | In place | All changes through version control and CI; production deploys from built images. |
| A.8.33 | Test information | Yes | In place | Synthetic data only in tests, demos and the sector lab. |
| A.8.34 | Protection of systems during audit testing | Yes | To do | Rules of engagement for the penetration test protect production (docs/PENTEST_RFQ.md). |
