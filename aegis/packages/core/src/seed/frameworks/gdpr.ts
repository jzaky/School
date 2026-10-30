/**
 * General Data Protection Regulation, Regulation (EU) 2016/679.
 *
 * Only article numbers are referenced. Titles and summaries are original AEGIS wording; no text of
 * the Regulation is reproduced. The Regulation is public (EUR-Lex). This catalog is a working map
 * for assessments, not legal advice.
 */
import { control as c, type FrameworkSeed } from "./types.js";

const PRINCIPLES = "Chapter II Principles";
const RIGHTS = "Chapter III Rights of the data subject";
const CONTROLLER = "Chapter IV Controller and processor";
const SECURITY = "Chapter IV Section 2 Security of personal data";
const DPIA = "Chapter IV Section 3 Impact assessment and prior consultation";
const DPO = "Chapter IV Section 4 Data protection officer";
const TRANSFER = "Chapter V Transfers to third countries";

export const GDPR: FrameworkSeed = {
  key: "gdpr",
  name: "GDPR (Regulation (EU) 2016/679)",
  version: "2016",
  publisher: "European Parliament and Council",
  licenseNote: "The Regulation is published on EUR-Lex. AEGIS references article numbers only; every title and summary is original AEGIS wording describing the obligation and is not the text of the Regulation. This catalog is a working map for assessments, not legal advice.",
  description: "Principles, lawful bases, data subject rights, controller and processor duties, security, breach notification, impact assessment, data protection officers and international transfers for personal data.",
  controls: [
    c("Art. 5", "Processing principles and accountability", "Personal data is processed lawfully, fairly and transparently, for specified purposes, minimised, accurate, retained no longer than needed and kept secure, and the controller can demonstrate all of this.", PRINCIPLES, ["principles", "lawfulness", "purpose limitation", "data minimisation", "accuracy", "storage limitation", "accountability"]),
    c("Art. 6", "Lawful basis for processing", "Every processing activity rests on one of the lawful bases, such as consent, contract, legal obligation, vital interests, public task or legitimate interests, and the basis is recorded.", PRINCIPLES, ["lawful basis", "consent", "contract", "legitimate interests", "legal obligation"]),
    c("Art. 7", "Conditions for consent", "Where consent is the basis, it is freely given, specific, informed, demonstrable and as easy to withdraw as to give.", PRINCIPLES, ["consent", "withdraw", "demonstrable", "freely given"]),
    c("Art. 9", "Special categories of data", "Data revealing health, biometrics, beliefs, origin, sexual orientation or similar is processed only under a specific exemption with appropriate safeguards.", PRINCIPLES, ["special categories", "sensitive data", "health", "biometric", "safeguards"], "data_protection"),
    c("Art. 12", "Transparent communication and facilitation of rights", "Information and responses to data subjects are concise, intelligible, easily accessible and free, and requests are answered within one month.", RIGHTS, ["transparency", "one month", "requests", "plain language", "facilitate rights"]),
    c("Art. 13", "Information when data is collected from the person", "At collection, the person is told who the controller is, the purposes and basis, recipients, retention, their rights and whether automated decision-making is used.", RIGHTS, ["privacy notice", "information", "collection", "purposes", "retention", "rights"]),
    c("Art. 14", "Information when data is not collected from the person", "When data comes from elsewhere, the person is given the same information within a reasonable period and told the source.", RIGHTS, ["privacy notice", "source", "indirect collection", "information"]),
    c("Art. 15", "Right of access", "A person can obtain confirmation that their data is processed, a copy of it and the related information about purposes, recipients, retention and safeguards.", RIGHTS, ["access request", "copy", "DSAR", "subject access"]),
    c("Art. 16", "Right to rectification", "Inaccurate or incomplete personal data is corrected or completed at the person's request without undue delay.", RIGHTS, ["rectification", "correction", "inaccurate"]),
    c("Art. 17", "Right to erasure", "Personal data is erased when it is no longer needed, consent is withdrawn, the person objects, processing was unlawful or a legal duty requires it, subject to exceptions.", RIGHTS, ["erasure", "deletion", "right to be forgotten", "retention"]),
    c("Art. 18", "Right to restriction of processing", "Processing is limited to storage while accuracy or lawfulness is contested or the person needs the data for legal claims.", RIGHTS, ["restriction", "contested accuracy", "legal claims"]),
    c("Art. 20", "Right to data portability", "Data the person provided is returned in a structured, commonly used, machine-readable format and transmitted to another controller where feasible.", RIGHTS, ["portability", "machine-readable", "export", "transmit"]),
    c("Art. 21", "Right to object", "A person can object to processing based on legitimate interests or public task, and always to direct marketing, and processing then stops unless compelling grounds prevail.", RIGHTS, ["object", "direct marketing", "legitimate interests", "opt out"]),
    c("Art. 22", "Automated individual decision-making", "A person is not subject to a decision with legal or similarly significant effects based solely on automated processing unless an exception applies, and then can obtain human intervention and contest it.", RIGHTS, ["automated decision", "profiling", "human intervention", "contest", "significant effect", "AI decision"], "approval_workflow"),
    c("Art. 24", "Responsibility of the controller", "The controller implements and can demonstrate technical and organizational measures proportionate to the risks of its processing, including data protection policies.", CONTROLLER, ["controller", "accountability", "measures", "policies", "demonstrate"], "policy_versioning"),
    c("Art. 25", "Data protection by design and by default", "Safeguards such as pseudonymisation and minimisation are built into processing from the design stage, and defaults limit processing to what each purpose needs.", CONTROLLER, ["privacy by design", "by default", "pseudonymisation", "minimisation"], "data_protection"),
    c("Art. 28", "Processors and processing contracts", "Processors are chosen for sufficient guarantees and bound by a contract that fixes the subject matter, duration, instructions, confidentiality, security, sub-processing, assistance, deletion and audit rights.", CONTROLLER, ["processor", "data processing agreement", "DPA", "sub-processor", "instructions", "audit"], "integration_security"),
    c("Art. 30", "Records of processing activities", "The controller and processor each keep a written record of their processing activities with purposes, categories, recipients, transfers, retention and security measures.", CONTROLLER, ["records of processing", "ROPA", "register", "inventory"], "agent_inventory"),
    c("Art. 32", "Security of processing", "Technical and organizational measures appropriate to the risk, such as encryption, pseudonymisation, resilience, recovery and regular testing, protect personal data.", SECURITY, ["security", "encryption", "pseudonymisation", "resilience", "testing", "access control"], "access_control"),
    c("Art. 33", "Breach notification to the supervisory authority", "A personal data breach is notified to the supervisory authority without undue delay and where feasible within 72 hours, with the facts, effects and measures, and every breach is documented.", SECURITY, ["breach notification", "72 hours", "supervisory authority", "breach register"], "incident_management"),
    c("Art. 34", "Communication of a breach to the data subject", "When a breach is likely to result in a high risk to people, they are told without undue delay in clear language unless an exception applies.", SECURITY, ["breach", "notify individuals", "high risk", "communication"], "incident_management"),
    c("Art. 35", "Data protection impact assessment", "Processing likely to result in a high risk, including systematic evaluation and large-scale sensitive or monitoring activities, is assessed in advance for necessity, risks and safeguards.", DPIA, ["DPIA", "impact assessment", "high risk", "profiling", "necessity", "safeguards"]),
    c("Art. 36", "Prior consultation", "Where a DPIA shows high residual risk the controller consults the supervisory authority before processing.", DPIA, ["prior consultation", "residual risk", "supervisory authority"]),
    c("Art. 37", "Designation of a data protection officer", "A data protection officer is designated where processing is by a public body, involves large-scale regular monitoring or large-scale special categories, and the officer's contact details are published.", DPO, ["DPO", "data protection officer", "designation", "contact details"]),
    c("Art. 44", "General principle for transfers", "Personal data leaves the EU only under a mechanism the Regulation allows, such as an adequacy decision, appropriate safeguards or a specific derogation.", TRANSFER, ["international transfer", "adequacy", "standard contractual clauses", "safeguards", "third country"]),
  ],
};
