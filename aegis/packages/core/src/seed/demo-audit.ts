/**
 * Demo audit data for Meridian Gulf Bank (fictional). Three synthetic policy documents in
 * original wording, two completed assessments (ISO/IEC 42001 and NIST AI RMF), a few human
 * validations, six remediation tasks in different states and one executive summary PDF.
 *
 * Run the shared catalog first with `seedSharedFrameworks()` (owner connection). Everything here
 * goes through the TenantDb. Call inside `withTenant(orgId, fn, { timeout: 120_000 })`: two
 * assessments over 137 controls take longer than the default 15 s transaction window.
 */
import type { TenantDb } from "@aegis/db";
import { makeContext, type OrgContext } from "../lib/context.js";
import { parseDocument, storeDocument } from "../audit/documents.js";
import { createAssessment, getAssessment, runAssessment, validateFinding } from "../audit/assessments.js";
import { createTask, transition } from "../audit/remediation.js";
import { generateReport } from "../audit/reports.js";
export { seedSharedFrameworks } from "./frameworks/index.js";

const DAY = 86400_000;

export const DEMO_AI_GOVERNANCE_POLICY = `# Meridian Gulf Bank - AI Governance Policy

Document ID: MGB-POL-AI-001 | Version 3.2 | Classification: Internal
Owner: Head of AI Governance | Approved by: Board Risk Committee | Last review: this year | Next review: in 12 months

## 1. Purpose and scope of the AI management system

This policy establishes the AI management system (AIMS) of Meridian Gulf Bank (the Bank). It sets the direction for how the Bank develops, procures, deploys, operates and retires AI systems, including autonomous and semi-autonomous AI agents that act on customer accounts, payments and internal systems. The scope and boundaries of the AIMS cover every AI system used in production or in customer-facing pilots across retail banking, payments operations, customer service and credit operations, at all sites and for all legal entities of the Bank. The scope statement is documented in the AIMS Scope Register and reviewed annually.

The Bank acts both as a user of third-party foundation models and as a developer of AI agents built on them. The AIMS is established, implemented, maintained and continually improved in line with the Bank's enterprise risk management framework and this policy.

## 2. Organizational context and interested parties

The AI Governance Office identifies and documents the internal and external factors that affect the intended outcomes of the AIMS, including the Bank's role as a regulated financial institution, its risk appetite, its technology strategy and public expectations of responsible AI. Interested parties and their expectations are recorded in the Stakeholder Register and include customers, employees, the central bank and other regulators, the Board, shareholders, model providers and the communities the Bank serves. Legal, regulatory and contractual requirements that apply to AI systems, including consumer protection, data protection and outsourcing rules, are identified, documented and kept up to date by Compliance.

## 3. Policy statement and principles

The Bank shall develop and use AI responsibly. All AI systems must be lawful, fair, transparent, accountable, safe, secure and respectful of privacy. The following principles apply to every AI system:

- Human accountability: a named AI system owner is accountable for each AI system throughout its life cycle.
- Human oversight: consequential actions proposed by AI agents, including payments above defined thresholds, refunds, account changes and credit decisions, require approval by an authorised person before execution.
- Transparency: customers and staff are informed when they interact with an AI system and about its purpose and limitations.
- Fairness: AI systems are assessed for bias and discriminatory outcomes before deployment and periodically in operation.
- Safety and security: AI systems fail safe, are protected against misuse, prompt injection and data leakage, and can be suspended immediately.
- Privacy: personal data used by AI systems is processed in line with the Privacy Policy and data protection law.

This policy is aligned with and cross-references the Information Security Policy (MGB-POL-SEC-001), the Privacy Policy, the Model Risk Management Standard, the Third-Party Risk Policy, the Code of Conduct and the Incident Response Procedure (MGB-PRC-IR-004). Where policies conflict, the stricter requirement applies.

## 4. Leadership, roles, responsibilities and authorities

The Board Risk Committee approves this policy, sets the AI risk appetite and receives a quarterly AI governance report. The Chief Information Security Officer and the Chief Risk Officer are jointly accountable to the Board for the effectiveness of the AIMS and provide the resources it needs.

The Head of AI Governance is responsible for operating the AIMS, maintaining the AI system inventory, running the AI Governance Committee and reporting on AI objectives. AI system owners are responsible for the intended use, risk assessment, impact assessment, performance and documentation of their systems. The AI Platform Engineering team is responsible for building, deploying and monitoring AI agents and for the technical controls described in section 8. Internal Audit provides independent assurance. Roles, responsibilities and decision authorities are documented in the AI Governance RACI matrix, assigned to named individuals and communicated to all affected staff. Permissions in governance systems are granted on a least-privilege basis and are reviewed quarterly.

## 5. AI objectives and planning

The AI Governance Committee sets measurable AI objectives each year, consistent with this policy, with owners, resources, timelines and key performance indicators. Progress is evaluated quarterly. Changes to the AIMS, including new AI use cases, changes to approval thresholds and new model providers, are planned and carried out in a controlled manner through the change management process.

## 6. AI system inventory and resources

Every AI system must be registered in the AI System Inventory before it is deployed. The inventory records the system's purpose and intended use, business and technical owners, risk tier, environment, model provider and model identifier, data categories processed, tools and permissions granted, and integration points. For each AI system the owner documents the resources it depends on: data resources (sources, categories, quality requirements), tooling resources (models, libraries, frameworks and evaluation tools), system and computing resources (hosting, compute and capacity), and human resources (the skills and roles needed for development, operation and oversight). The inventory is reconciled with the agent registry each quarter.

## 7. AI risk management

The Bank applies a documented AI risk assessment process. For each AI system the owner identifies risks to the Bank, its customers and third parties, analyses likelihood and consequence using the enterprise risk criteria, evaluates the result against the AI risk tolerance set by the Board and records the outcome in the AI Risk Register. Risk assessments are performed before deployment, at least annually and whenever a significant change occurs, and results are retained for seven years.

Risk treatment options (mitigate, transfer, avoid or accept) are selected for every risk above tolerance. The necessary controls are determined, compared with the controls in the Bank's control library and recorded in a risk treatment plan approved by the risk owner. Residual risk is documented and accepted by the AI system owner and, for high-tier systems, by the Chief Risk Officer. Implementation of the risk treatment plan is tracked and evidenced.

## 8. AI system impact assessment

Before any AI system is deployed, and at least annually thereafter, the AI system owner performs an AI system impact assessment using the Bank's documented process. The assessment considers the potential consequences for individuals and groups, including fairness and bias, discrimination, safety, privacy, financial harm and access to services, as well as broader societal impacts such as environmental and economic effects. The likelihood and magnitude of each beneficial and harmful impact are recorded. Impact assessment results are documented in the Impact Assessment Register, reviewed by the AI Governance Committee and retained for seven years. Material adverse impacts must be mitigated before deployment.

## 9. AI system life cycle controls

The Bank applies defined processes for responsible design, development, deployment and operation of AI systems:

9.1 Requirements and specification. Each AI system has a documented specification stating its intended purpose, functional and trustworthiness requirements, constraints and the tasks and methods it uses.

9.2 Design and development documentation. Design decisions, data used, model selection, prompts, tools and trade-offs are documented in the system design record and model card.

9.3 Verification and validation. AI systems are tested against their requirements and acceptance criteria before release, including accuracy, robustness, fairness, security and prompt injection testing. Test sets, metrics and results are recorded.

9.4 Deployment. AI systems are deployed to production only through the deployment plan, with release approval by the AI system owner and the Head of AI Governance. Deployment approvals are recorded in the approval workflow of the governance platform.

9.5 Operation and monitoring. Deployed AI systems are operated according to documented runbooks and are monitored continuously for performance, drift, misuse, error rates and policy violations. Monitoring rules with thresholds raise alerts that are triaged by the AI Platform Engineering team and, where needed, escalated as incidents.

9.6 Event logging. Every action requested by an AI agent, every authorization decision, every approval and every execution is recorded in a tamper-evident evidence ledger with hash chaining. Logs are protected from modification, retained for at least seven years and available to Internal Audit and regulators.

9.7 Technical documentation. Technical documentation sufficient for users, auditors and regulators to understand each AI system is maintained and version controlled.

9.8 Decommissioning. AI systems are retired through a documented decommissioning procedure that revokes credentials and tool permissions, archives records and confirms that dependent processes have alternatives.

## 10. Human oversight and responsible use

Consequential actions proposed by AI agents must be approved by an authorised person through the approval workflow before they execute. Approval thresholds, required roles and separation of duties rules are defined in policy and enforced by the governance platform. Approvers must not approve actions requested on behalf of themselves or by agents they own. AI systems are used only for their documented intended purpose and within stated constraints; any other use is prohibited. Staff must follow the Acceptable Use of AI Standard.

Any authorised person may suspend an AI agent immediately when it behaves inconsistently with its intended use; the AI system owner and the Head of AI Governance may revoke tools, disengage or deactivate the system. These emergency controls, and the responsibilities for using them, are documented and tested twice a year.

## 11. Data for AI systems

Data used to develop, evaluate and operate AI systems is governed by the Data Governance Standard. Data acquisition is documented, recording the source, the legal basis or consent, licensing conditions and classification of each dataset. Data quality criteria (accuracy, completeness, timeliness and representativeness) are defined and data is checked against them before use. Data provenance and lineage, including processing history, are recorded. Data preparation steps such as cleaning, labelling and transformation are documented and reproducible. Personal data is minimised, masked where possible and never used to train third-party models without explicit approval.

## 12. Transparency and information for interested parties

Users of AI systems receive clear information about the system's purpose, capabilities, limitations and how to raise issues or request human review. Customers are told when they interact with an AI system. The Bank publishes an external channel through which customers and the public can report adverse impacts or complaints about its AI systems. Incidents involving AI systems are communicated to affected customers and to the relevant authorities in line with the Incident Response Procedure. Regulators, partners and other interested parties receive information about the Bank's AI systems appropriate to their role and the applicable obligations.

## 13. Third parties, suppliers and customers

Responsibilities for AI shared with model providers, software suppliers, partners and customers are allocated and documented in contracts and the shared responsibility matrix. Suppliers of AI products and services undergo due diligence under the Third-Party Risk Policy, including security, privacy, model risk and responsible AI requirements, before onboarding and at least annually. Contingency plans are maintained for the failure or withdrawal of high-risk third-party models and data, including fallback to manual processing. The Bank considers its customers' obligations when it provides AI-enabled services.

## 14. Competence, awareness and training

Staff whose work affects AI systems must have the competence required for their role, demonstrated through education, training or experience. All staff and contractors complete AI governance awareness training on joining and annually thereafter; AI system owners, engineers and approvers complete role-specific training. Training records are retained by Human Resources.

## 15. Communication

The AI Governance Office maintains a communication plan that defines what is communicated about AI internally and externally, when, to whom and by whom, including regulatory notifications and public disclosures.

## 16. Documented information

Documents and records required by the AIMS are identified, version controlled, approved before issue, protected from unauthorised change and retained in line with the records retention schedule. This policy and its supporting standards are held in the governance platform with full version history.

## 17. Performance evaluation

The Head of AI Governance defines what is monitored and measured about AI systems and the AIMS, the methods, the frequency and who evaluates the results. Metrics include approval rates, denied actions, incident counts, drift indicators and training completion. Internal Audit performs an independent internal audit of the AIMS at least annually against this policy and ISO/IEC 42001, reporting nonconformities to the Audit Committee. Top management conducts a management review of the AIMS at least annually, considering performance, risks, audit results, stakeholder feedback and opportunities for improvement, and records its decisions.

## 18. Nonconformity, corrective action and continual improvement

Nonconformities and AI incidents are recorded, their root causes analysed and corrective actions taken and tracked to closure; the effectiveness of corrective actions is reviewed. Lessons learned are fed back into policies, controls and training to continually improve the suitability, adequacy and effectiveness of the AIMS.

## 19. Reporting of concerns

Any employee, contractor or third party may raise a concern about an AI system through the Speak Up channel, anonymously if they wish. Concerns are investigated by the AI Governance Office and, where appropriate, Internal Audit. Retaliation against anyone who raises a concern in good faith is prohibited.

## 20. Policy review

This policy is reviewed at least annually and after any significant change in regulation, technology or the Bank's use of AI. Changes are approved by the Board Risk Committee. Version history is maintained in the governance platform.
`;

export const DEMO_INFORMATION_SECURITY_POLICY = `# Meridian Gulf Bank - Information Security Policy

Document ID: MGB-POL-SEC-001 | Version 7.0 | Classification: Internal
Owner: Chief Information Security Officer | Approved by: Executive Committee | Reviewed annually

## 1. Purpose and scope

This policy defines how Meridian Gulf Bank protects the confidentiality, integrity and availability of information and the systems that process it, including AI agents and the governance platform that controls them. It applies to all employees, contractors, suppliers and systems.

## 2. Roles and responsibilities

The Chief Information Security Officer (CISO) is responsible for this policy and the information security management system. Information asset owners are accountable for the classification and protection of their assets. Line managers must make sure their teams understand and apply this policy. Security responsibilities are defined in role descriptions and the security RACI, and conflicting duties are segregated so that no single person can request, approve and execute a sensitive change.

## 3. Asset inventory and classification

All information assets, systems, AI agents and integrations are recorded in the asset inventory with a named owner. Information is classified as Public, Internal, Confidential or Restricted according to its sensitivity and regulatory requirements, and labelled accordingly. Handling rules for each classification, including acceptable use, transfer, storage and disposal, are defined in the Information Handling Standard. Personal data and payment data are always at least Confidential.

## 4. Access control

Access to information and systems is granted on a least-privilege and need-to-know basis through documented access control rules. Identities are unique and managed through their whole life cycle. Multi-factor authentication is mandatory for all staff and for privileged access. Privileged access rights are restricted, time-bound where possible and logged. Access rights are reviewed quarterly by asset owners and removed within 24 hours of termination or role change. Access to source code and deployment pipelines is restricted to authorised engineers.

## 5. Cryptography

Confidential and Restricted information is encrypted in transit using TLS 1.2 or higher and at rest using approved algorithms. Cryptographic keys and secrets are stored in the key management service, rotated at least annually and never embedded in source code or logs.

## 6. Logging and monitoring

Security-relevant events, including authentication, privileged actions, policy decisions and AI agent actions, are logged centrally, protected from modification and retained for at least seven years. Logs are monitored continuously for anomalous behaviour and alerts are investigated by the Security Operations team. Clocks are synchronised to an approved time source.

## 7. Supplier and cloud security

Security requirements are agreed with suppliers in contracts before onboarding. Supplier security is assessed before engagement and reviewed at least annually based on risk. Cloud services are used only after a documented risk assessment and with a clear shared responsibility model, and exit plans are maintained.

## 8. Change management and secure development

Changes to production systems follow the change management procedure and require testing, approval by the change authority and a rollback plan. Development, test and production environments are separated. Software is developed under the secure development standard, including secure coding, code review and security testing before release.

## 9. Backup and continuity

Information and systems are backed up according to the backup standard and restores are tested at least twice a year. Business continuity and disaster recovery plans cover critical services and are exercised annually.

## 10. Incident reporting

Everyone must report suspected security events immediately through the Security Operations channel. Incidents are managed under the Incident Response Procedure (MGB-PRC-IR-004).

## 11. Awareness and training

All staff complete security awareness training on joining and annually. Role-specific training is provided to engineers, administrators and approvers.

## 12. Compliance and review

Compliance with this policy is reviewed by Information Security and Internal Audit. Violations may lead to disciplinary action. This policy is reviewed annually and approved by the Executive Committee.
`;

export const DEMO_INCIDENT_RESPONSE_PROCEDURE = `# Meridian Gulf Bank - Incident Response Procedure

Document ID: MGB-PRC-IR-004 | Version 4.1 | Classification: Internal
Owner: Head of Security Operations | Approved by: Chief Information Security Officer | Reviewed annually and after every major incident

## 1. Purpose and scope

This procedure defines how the Bank detects, assesses, contains, eradicates, recovers from and learns from security incidents and AI system incidents. An AI system incident is any event in which an AI agent acts outside its intended use, produces harmful or discriminatory outcomes, leaks data, is manipulated through prompt injection, or causes financial loss or customer harm. The procedure applies to all staff, contractors, suppliers and AI systems.

## 2. Roles and responsibilities

The Incident Commander (the on-call Security Operations lead) is responsible for coordinating the response and for all containment decisions. The Security Analyst investigates and documents the incident. The AI system owner is responsible for assessing the impact on customers and for the business decision to suspend, roll back or reinstate an AI agent. Legal and Compliance are responsible for regulatory notifications. Communications is responsible for customer and public messaging. The Head of AI Governance is informed of every AI system incident.

## 3. Detection and reporting

Incidents are detected through monitoring alerts, Shield security events (data classification, tool security and injection detectors), anomalies in the evidence ledger, staff reports, customer complaints and reports from external parties or suppliers. All personnel must report suspected security events immediately through the Security Operations channel. External parties can report adverse impacts of the Bank's AI systems through the published responsible AI contact channel.

## 4. Assessment and classification

Every reported event is assessed within fifteen minutes during business hours and within one hour outside them. The Security Analyst decides whether the event is an incident and assigns a severity: Critical (customer funds or data at risk, regulatory impact), High (policy bypass or systemic AI misbehaviour), Medium (contained issue with limited impact) or Low (no harm, process improvement). The decision and its reasoning are recorded in the incident record.

## 5. Containment

Containment actions include suspending the AI agent through the governance platform, revoking the agent's API keys and tool permissions, pausing pending approvals, blocking affected integrations and isolating systems. Suspension of a production AI agent is approved by the Incident Commander and recorded. Where an agent has executed consequential actions, the Incident Commander instructs Payments Operations to reverse or hold transactions.

## 6. Evidence collection and preservation

The Security Analyst preserves evidence: evidence ledger exports with verified hash chains, authorization decisions, approval records, execution receipts, prompts and outputs, system logs and screenshots. Evidence is stored in the restricted incident repository with a chain of custody record stating who collected it, when and how. Evidence is never altered; copies are hashed and the hashes are recorded.

## 7. Eradication and recovery

Root causes such as a flawed policy rule, a vulnerable tool, a compromised credential or a manipulated prompt are removed before any affected AI agent returns to service. Recovery requires the AI system owner's approval, a successful re-run of the validation test set and confirmation that monitoring is active. Reinstatement is recorded in the governance platform.

## 8. Communication and notification

Affected customers are informed clearly and promptly about what happened, what the Bank has done and what they should do. Regulators are notified by Legal and Compliance within the timeframes required by applicable regulation. The Board Risk Committee is informed of all Critical and High incidents within 24 hours. Internal communications keep affected teams informed throughout the incident.

## 9. Third-party incidents

Incidents originating with model providers, software suppliers or integration partners are managed under this procedure together with the supplier's incident process defined in the contract. Contingency plans, including fallback to manual processing, are activated when a high-risk third-party model or data source fails or is withdrawn.

## 10. Post-incident review and corrective action

A post-incident review is held within ten working days of closure for every Critical, High and AI system incident. The review documents the timeline, root cause, effectiveness of the response, and corrective and preventive actions with owners and due dates. Corrective actions are tracked to closure and their effectiveness is verified. Lessons learned are shared with the AI Governance Committee and incorporated into policies, controls, monitoring rules and training.

## 11. Testing and review

This procedure is exercised at least annually through a tabletop scenario that includes an AI agent incident. The procedure is reviewed annually and after every major incident, and changes are approved by the Chief Information Security Officer.
`;

export interface SeedDemoAuditResult {
  documents: { id: string; title: string; chunkCount: number }[];
  assessments: { id: string; frameworkKey: string; counts: Record<string, number>; coveragePercent: number }[];
  validated: number;
  tasks: { id: string; status: string }[];
  export: { exportId: string; bytes: number; sha256: string };
}

async function userCtx(db: TenantDb, orgId: string, userId: string, now: Date, label: string): Promise<OrgContext> {
  const m = await db.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { role: true } });
  return makeContext(orgId, { type: "user", id: userId, label, permissions: m?.role.permissions ?? [], membershipId: m?.id }, { now });
}

export async function seedDemoAudit(db: TenantDb, ctx: OrgContext, opts: { ownerUserId: string; auditorUserId: string }): Promise<SeedDemoAuditResult> {
  const orgId = ctx.orgId;
  const base = (ctx.now ?? new Date()).getTime();
  const at = (daysAgo: number, hour = 10) => new Date(base - daysAgo * DAY + hour * 3600_000 - 10 * 3600_000);
  const owner = (d: Date) => userCtx(db, orgId, opts.ownerUserId, d, "Owner");
  const auditor = (d: Date) => userCtx(db, orgId, opts.auditorUserId, d, "Internal Audit");
  const otherOwners = await db.membership.findMany({ where: { orgId, status: "active", userId: { notIn: [opts.ownerUserId, opts.auditorUserId] } }, select: { userId: true }, take: 3 });
  const owners = [opts.ownerUserId, opts.auditorUserId, ...otherOwners.map((m) => m.userId)];

  // Documents: uploaded over the past weeks, parsed right away.
  const docSpecs = [
    { title: "AI Governance Policy", filename: "MGB-POL-AI-001-v3.2.md", body: DEMO_AI_GOVERNANCE_POLICY, daysAgo: 42 },
    { title: "Information Security Policy", filename: "MGB-POL-SEC-001-v7.0.md", body: DEMO_INFORMATION_SECURITY_POLICY, daysAgo: 41 },
    { title: "Incident Response Procedure", filename: "MGB-PRC-IR-004-v4.1.md", body: DEMO_INCIDENT_RESPONSE_PROCEDURE, daysAgo: 38 },
  ];
  const documents: SeedDemoAuditResult["documents"] = [];
  for (const spec of docSpecs) {
    const c = await owner(at(spec.daysAgo));
    const stored = await storeDocument(db, c, { title: spec.title, filename: spec.filename, mime: "text/markdown", buffer: Buffer.from(spec.body, "utf8") });
    const parsed = await parseDocument(db, { ...c, now: at(spec.daysAgo, 10.1) }, stored.id);
    documents.push({ id: parsed.id, title: parsed.title, chunkCount: parsed.chunkCount });
  }
  const documentIds = documents.map((d) => d.id);

  // Assessments: ISO 42001 a month ago, NIST AI RMF last week.
  const frameworks = await db.framework.findMany({ where: { orgId: null, key: { in: ["iso-42001", "nist-ai-rmf-1.0"] } } });
  const iso = frameworks.find((f) => f.key === "iso-42001");
  const nist = frameworks.find((f) => f.key === "nist-ai-rmf-1.0");
  if (!iso || !nist) throw new Error("Shared frameworks are missing. Run seedSharedFrameworks() first.");
  const assessments: SeedDemoAuditResult["assessments"] = [];
  const runOne = async (frameworkId: string, key: string, name: string, scope: string, daysAgo: number) => {
    const c = await auditor(at(daysAgo));
    const a = await createAssessment(db, c, { frameworkId, name, scope, documentIds });
    const done = await runAssessment(db, { ...c, now: at(daysAgo, 10.5) }, a.id);
    const summary = done.summary as { counts: Record<string, number>; coveragePercent: number };
    assessments.push({ id: done.id, frameworkKey: key, counts: summary.counts, coveragePercent: summary.coveragePercent });
    return done.id;
  };
  const isoId = await runOne(iso.id, iso.key, "ISO/IEC 42001 readiness review Q3", "AI agents in payments operations and customer service, governance platform and supporting policies.", 30);
  const nistId = await runOne(nist.id, nist.key, "NIST AI RMF profile - agentic payments", "Autonomous payment and refund agents, model provider dependencies and human oversight controls.", 7);

  // Human validation of a few ISO findings by Internal Audit.
  const isoView = await getAssessment(db, await auditor(at(28)), isoId);
  const byCode = new Map(isoView.findings.map((f) => [f.control.code, f]));
  const validations: { code: string; status: "covered" | "partial" | "missing" | "ambiguous"; note: string }[] = [
    { code: "5.2", status: "covered", note: "Policy MGB-POL-AI-001 v3.2 approved by the Board Risk Committee; version history confirmed in the platform." },
    { code: "A.6.2.5", status: "covered", note: "Deployment approvals observed in the approval workflow for three releases; sampled evidence consistent with the policy." },
    { code: "A.5.4", status: "partial", note: "Impact assessment template exists but only two of six production agents have a completed assessment on file." },
    { code: "A.7.4", status: "partial", note: "Data quality criteria are defined; evidence of checks before use was not available for the refund agent dataset." },
    { code: "9.2", status: "missing", note: "No internal audit of the AIMS has been performed yet; first audit scheduled for next quarter." },
  ];
  let validated = 0;
  for (const [i, v] of validations.entries()) {
    const f = byCode.get(v.code);
    if (!f) continue;
    await validateFinding(db, await auditor(at(27 - i, 11)), f.id, { humanStatus: v.status, note: v.note });
    validated++;
  }

  // Remediation tasks in different states, linked to real findings.
  const pick = (code: string) => byCode.get(code)?.id;
  const tasks: SeedDemoAuditResult["tasks"] = [];
  const mk = async (daysAgo: number, input: { code?: string; title: string; description: string; ownerIdx: number; dueInDays: number }, steps: { status: "in_progress" | "review" | "resolved" | "reopened"; daysAgo: number; note: string }[]) => {
    const c = await auditor(at(daysAgo, 12));
    const t = await createTask(db, c, { findingId: input.code ? pick(input.code) : undefined, title: input.title, description: input.description, ownerId: owners[input.ownerIdx % owners.length]!, dueAt: new Date(base + input.dueInDays * DAY) });
    let last = t;
    for (const s of steps) last = await transition(db, await owner(at(s.daysAgo, 14)), t.id, s.status, s.note);
    tasks.push({ id: last.id, status: last.status });
  };
  await mk(26, { code: "9.2", title: "Plan and perform the first internal audit of the AIMS", description: "Define the audit programme, criteria and auditor independence; perform the audit against MGB-POL-AI-001 and ISO/IEC 42001; report nonconformities to the Audit Committee.", ownerIdx: 1, dueInDays: 45 }, [{ status: "in_progress", daysAgo: 20, note: "Audit programme drafted; fieldwork starts next month." }]);
  await mk(26, { code: "A.5.4", title: "Complete impact assessments for all production AI agents", description: "Four production agents lack a completed AI system impact assessment covering fairness, privacy, safety and financial harm. Complete and file them in the Impact Assessment Register.", ownerIdx: 2, dueInDays: -5 }, []);
  await mk(25, { code: "A.7.4", title: "Evidence data quality checks for the refund agent dataset", description: "Run the defined data quality checks (accuracy, completeness, representativeness) on the refund agent evaluation dataset and attach the report.", ownerIdx: 3, dueInDays: 10 }, [{ status: "in_progress", daysAgo: 18, note: "Checks scripted." }, { status: "review", daysAgo: 4, note: "Report attached for review." }]);
  await mk(25, { code: "A.8.3", title: "Publish the external channel for reporting AI adverse impacts", description: "Make the responsible AI contact channel visible on the public website and in the mobile app, and route reports to the AI Governance Office.", ownerIdx: 0, dueInDays: -2 }, [{ status: "in_progress", daysAgo: 21, note: "Web copy approved." }, { status: "review", daysAgo: 12, note: "Page live; please verify routing." }, { status: "resolved", daysAgo: 10, note: "Verified end to end." }]);
  await mk(24, { code: "A.4.6", title: "Document human resources and oversight skills per AI system", description: "Add the human skills and oversight roles required for each AI system to the AI System Inventory.", ownerIdx: 2, dueInDays: -1 }, [{ status: "in_progress", daysAgo: 20, note: "Started with payments agents." }, { status: "review", daysAgo: 15, note: "Ready for review." }, { status: "resolved", daysAgo: 14, note: "Accepted." }, { status: "reopened", daysAgo: 3, note: "Two customer service agents still missing oversight roles." }]);
  await mk(6, { title: "Map NIST AI RMF MEASURE gaps to the quarterly metrics review", description: "Add fairness, privacy and environmental impact measurements to the quarterly AI metrics pack so MEASURE 2.10 to 2.12 have evidence.", ownerIdx: 1, dueInDays: 30 }, []);

  // One executive summary PDF for the ISO assessment.
  const exp = await generateReport(db, await auditor(at(2, 9)), { assessmentId: isoId, kind: "executive_summary", format: "pdf" });
  void nistId;
  return { documents, assessments, validated, tasks, export: { exportId: exp.exportId, bytes: exp.bytes, sha256: exp.sha256 } };
}
