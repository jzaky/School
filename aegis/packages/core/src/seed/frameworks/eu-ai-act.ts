/**
 * EU Artificial Intelligence Act, Regulation (EU) 2024/1689.
 *
 * Only article numbers are referenced. Titles and one-sentence summaries are original AEGIS wording
 * describing the obligation; no text of the Regulation is reproduced. The Regulation itself is
 * public (EUR-Lex); this catalog is a working map for assessments, not legal advice.
 */
import { control as c, type FrameworkSeed } from "./types.js";

const GENERAL = "Chapter I General provisions";
const PROHIBITED = "Chapter II Prohibited practices";
const REQ = "Chapter III Section 2 Requirements for high-risk AI systems";
const OBL = "Chapter III Section 3 Obligations of providers and deployers";
const CONF = "Chapter III Sections 4 and 5 Notification and conformity";
const TRANSP = "Chapter IV Transparency obligations";
const GPAI = "Chapter V General-purpose AI models";
const POST = "Chapter IX Post-market monitoring and incident reporting";
const REMEDY = "Chapter X Remedies";

export const EU_AI_ACT: FrameworkSeed = {
  key: "eu-ai-act",
  name: "EU AI Act (Regulation (EU) 2024/1689)",
  version: "2024",
  publisher: "European Parliament and Council",
  licenseNote: "The Regulation is published on EUR-Lex. AEGIS references article numbers only; every title and summary is original AEGIS wording describing the obligation and is not the text of the Regulation. Obligations apply in phases from 2025 to 2027 and depend on the system's role and risk class; this catalog is a working map for assessments, not legal advice.",
  description: "Obligations for providers and deployers of AI systems in the EU: prohibited practices, the requirements and duties attached to high-risk systems, transparency duties, general-purpose model obligations, post-market monitoring and incident reporting.",
  controls: [
    c("Art. 4", "AI literacy of staff", "People who operate or use AI systems on the organization's behalf have a level of AI understanding suited to their role and the context of use.", GENERAL, ["AI literacy", "training", "staff", "competence", "awareness"]),
    c("Art. 5", "No prohibited AI practices", "The organization does not place on the market or use AI for the practices the Regulation bans, such as manipulative or exploitative techniques, social scoring and untargeted facial scraping.", PROHIBITED, ["prohibited practices", "manipulation", "social scoring", "biometric", "banned uses"]),
    c("Art. 6", "High-risk classification decided and recorded", "Each AI system is classified against the Annex I and Annex III criteria, and a system judged not high-risk despite an Annex III use has that reasoning documented.", GENERAL, ["classification", "high-risk", "Annex III", "risk class", "documented assessment"], "agent_inventory"),
    c("Art. 9", "Risk management system across the life cycle", "A continuous, iterative risk management process identifies, estimates and mitigates the risks a high-risk system poses to health, safety and fundamental rights, and is tested and updated.", REQ, ["risk management", "life cycle", "mitigation", "residual risk", "testing", "iterative"]),
    c("Art. 10", "Data and data governance", "Training, validation and test data meet quality criteria, with documented governance over collection, origin, preparation, bias examination and gaps.", REQ, ["data governance", "training data", "bias", "data quality", "representativeness", "provenance"], "data_protection"),
    c("Art. 11", "Technical documentation", "Technical documentation drawn up before the system is placed on the market shows how it meets the requirements and is kept current.", REQ, ["technical documentation", "Annex IV", "documentation", "design", "development"]),
    c("Art. 12", "Automatic recording of events", "The system logs events over its lifetime so that its operation can be traced, risky situations identified and post-market monitoring supported.", REQ, ["logging", "record-keeping", "traceability", "audit trail", "events", "logs"], "evidence_ledger"),
    c("Art. 13", "Transparency and instructions for deployers", "Deployers receive clear information about the system's capabilities, limits, intended purpose, performance, oversight measures and expected lifetime.", REQ, ["transparency", "instructions for use", "capabilities", "limitations", "intended purpose"]),
    c("Art. 14", "Human oversight by design", "The system is designed so that people can understand, monitor, override, interrupt and stop it, and oversight measures are proportionate to its risks.", REQ, ["human oversight", "override", "stop", "intervene", "human in the loop", "approval"], "approval_workflow"),
    c("Art. 15", "Accuracy, robustness and cybersecurity", "The system reaches appropriate accuracy, is resilient to errors and inconsistencies, and resists attempts to alter its use or output, including data and model poisoning and adversarial inputs.", REQ, ["accuracy", "robustness", "cybersecurity", "adversarial", "resilience", "poisoning", "prompt injection"], "security_events"),
    c("Art. 16", "Provider obligations", "Providers of high-risk systems ensure compliance, identify themselves on the system, run a quality management system, keep documentation and logs, undergo conformity assessment and take corrective action.", OBL, ["provider", "obligations", "compliance", "marking", "corrective action"]),
    c("Art. 17", "Quality management system", "A documented quality management system covers compliance strategy, design and development controls, testing, data management, risk management, post-market monitoring, incident reporting and accountability.", OBL, ["quality management system", "QMS", "procedures", "accountability", "documented policies"], "policy_versioning"),
    c("Art. 18", "Retention of documentation", "Technical documentation, quality system records, approved changes and conformity documents are kept at the authorities' disposal for ten years.", OBL, ["retention", "ten years", "documentation", "records", "authorities"]),
    c("Art. 19", "Retention of automatically generated logs", "Providers keep the logs the system generates, when under their control, for a period appropriate to the intended purpose and at least six months.", OBL, ["logs", "retention", "six months", "record-keeping"], "evidence_ledger"),
    c("Art. 20", "Corrective actions and duty to inform", "A provider that considers a system non-compliant withdraws, disables or recalls it and informs distributors, deployers, importers and authorities.", OBL, ["corrective action", "withdraw", "recall", "disable", "notify"]),
    c("Art. 21", "Cooperation with authorities", "Providers supply competent authorities, on reasoned request, with the information and logs needed to show conformity.", OBL, ["cooperation", "authorities", "information request", "logs", "access"]),
    c("Art. 25", "Responsibilities along the value chain", "A party that puts its name on a system, substantially modifies it or changes its intended purpose takes on provider obligations, and contracts set out the cooperation needed.", OBL, ["value chain", "substantial modification", "distributor", "importer", "contracts", "third parties"], "integration_security"),
    c("Art. 26", "Deployer obligations", "Deployers use high-risk systems according to the instructions, assign competent people to oversight, keep logs they control, monitor operation, inform affected workers and report risks and incidents.", OBL, ["deployer", "instructions for use", "oversight", "monitoring", "logs", "workers", "inform"], "monitoring"),
    c("Art. 27", "Fundamental rights impact assessment", "Deployers that are public bodies or provide certain services assess the impact on fundamental rights before first use and notify the market surveillance authority.", OBL, ["fundamental rights", "impact assessment", "FRIA", "deployer", "public body"]),
    c("Art. 43", "Conformity assessment", "High-risk systems undergo the applicable conformity assessment procedure before being placed on the market and again after substantial modification.", CONF, ["conformity assessment", "notified body", "internal control", "substantial modification"]),
    c("Art. 47", "EU declaration of conformity", "A written, signed declaration of conformity is drawn up for each high-risk system and kept for ten years.", CONF, ["declaration of conformity", "signed", "ten years"]),
    c("Art. 49", "Registration in the EU database", "Providers and certain deployers register high-risk systems in the EU database before placing them on the market or using them.", CONF, ["registration", "EU database", "high-risk"], "agent_inventory"),
    c("Art. 50", "Transparency towards people", "People are told when they interact with an AI system, synthetic content is marked as generated, and deployers disclose emotion recognition, biometric categorisation and deep fakes.", TRANSP, ["transparency", "disclosure", "chatbot", "synthetic content", "watermark", "deep fake"]),
    c("Art. 53", "General-purpose AI model provider obligations", "Providers of general-purpose models keep technical documentation, give downstream providers the information they need, respect copyright law and publish a training-content summary.", GPAI, ["general-purpose AI", "foundation model", "documentation", "downstream", "copyright", "training data summary"]),
    c("Art. 55", "Systemic-risk general-purpose models", "Providers of models with systemic risk evaluate and adversarially test them, assess and mitigate systemic risks, report serious incidents and secure the model and its infrastructure.", GPAI, ["systemic risk", "adversarial testing", "red teaming", "incident reporting", "cybersecurity"]),
    c("Art. 72", "Post-market monitoring", "Providers run a documented post-market monitoring system that collects and analyses performance data over the system's lifetime and feeds the risk management process.", POST, ["post-market monitoring", "performance data", "monitoring plan", "continuous"], "monitoring"),
    c("Art. 73", "Reporting of serious incidents", "Serious incidents are reported to the market surveillance authority within the set deadlines, investigated and followed by corrective action.", POST, ["serious incident", "reporting", "deadline", "investigation", "corrective action"], "incident_management"),
    c("Art. 86", "Right to an explanation of individual decisions", "A person subject to a decision taken on the basis of a high-risk system's output can obtain a clear explanation of the system's role and the main elements of the decision.", REMEDY, ["explanation", "individual decision", "affected person", "right", "explainability"]),
  ],
};
