/**
 * ISO/IEC 42001:2023 (AI management system) control catalog.
 *
 * Only clause and Annex A identifiers are referenced. Titles and one-sentence summaries are
 * original AEGIS wording describing the objective of each clause or control; no text from the
 * standard is reproduced. Customers need their own licensed copy of the standard.
 */
import { control as c, type FrameworkSeed } from "./types.js";

const CLAUSES = "Management system clauses";
const A2 = "Annex A.2 AI policies";
const A3 = "Annex A.3 Internal organization";
const A4 = "Annex A.4 Resources for AI systems";
const A5 = "Annex A.5 Impact assessment";
const A6 = "Annex A.6 AI system life cycle";
const A7 = "Annex A.7 Data for AI systems";
const A8 = "Annex A.8 Information for interested parties";
const A9 = "Annex A.9 Use of AI systems";
const A10 = "Annex A.10 Third parties and customers";

export const ISO_42001: FrameworkSeed = {
  key: "iso-42001",
  name: "ISO/IEC 42001:2023 AI Management System",
  version: "2023",
  publisher: "ISO/IEC",
  licenseNote:
    "ISO/IEC 42001:2023 is copyrighted by ISO and IEC. AEGIS references clause and Annex A identifiers only; every title and summary here is original AEGIS wording describing the control objective and is not the text of the standard. Customers must hold their own licensed copy of the standard to interpret and implement it.",
  description: "Requirements for establishing, running and improving an AI management system, plus the Annex A control areas for AI policies, roles, resources, impact assessment, life cycle, data, transparency, responsible use and third parties.",
  controls: [
    // Clauses 4 to 10
    c("4.1", "Organizational context for AI", "The organization identifies the internal and external factors, including its role as a provider or user of AI, that affect what its AI management system must achieve.", CLAUSES, ["organizational context", "role", "AI provider", "AI user", "external factors", "internal factors"]),
    c("4.2", "Interested parties and their expectations", "Stakeholders affected by the organization's AI systems are identified together with their requirements, including legal and regulatory obligations.", CLAUSES, ["interested parties", "stakeholders", "regulatory requirements", "legal obligations", "expectations"]),
    c("4.3", "Scope of the AI management system", "The boundaries and applicability of the AI management system are defined and recorded, stating which AI systems, sites and activities are included.", CLAUSES, ["scope", "boundaries", "applicability", "AI management system", "AIMS"]),
    c("4.4", "The AI management system", "The organization establishes, operates, maintains and continually improves a management system covering the processes needed for trustworthy AI.", CLAUSES, ["management system", "processes", "continual improvement", "establish", "maintain"]),
    c("5.1", "Leadership commitment to AI governance", "Top management visibly owns the AI management system, provides resources and makes sure AI objectives align with business direction.", CLAUSES, ["leadership", "top management", "commitment", "accountability", "resources", "board"]),
    c("5.2", "AI policy established by leadership", "An AI policy approved by top management sets the direction for responsible AI, is communicated internally and made available to relevant parties.", CLAUSES, ["AI policy", "approved by", "communicated", "responsible AI", "principles"], "policy_versioning"),
    c("5.3", "AI roles, responsibilities and authorities", "Responsibilities and decision rights for AI governance are assigned, communicated and understood across the organization.", CLAUSES, ["roles", "responsibilities", "authorities", "accountable", "assigned", "RACI"], "access_control"),
    c("6.1.1", "Planning for AI risks and opportunities", "Planning identifies the risks and opportunities that must be addressed so the AI management system achieves its outcomes and prevents undesired effects.", CLAUSES, ["risks", "opportunities", "planning", "undesired effects", "intended outcomes"]),
    c("6.1.2", "AI risk assessment process", "A repeatable process identifies, analyses and evaluates AI risks against defined criteria and produces comparable, documented results.", CLAUSES, ["risk assessment", "risk criteria", "likelihood", "consequence", "risk register", "risk analysis"]),
    c("6.1.3", "AI risk treatment", "Risk treatment options are selected, the necessary controls are determined and compared with Annex A, and a treatment plan is approved by risk owners.", CLAUSES, ["risk treatment", "treatment plan", "controls", "statement of applicability", "risk owner", "residual risk"]),
    c("6.1.4", "AI system impact assessment process", "The organization defines how it assesses the potential consequences of its AI systems for individuals, groups and society, and keeps the results.", CLAUSES, ["impact assessment", "individuals", "groups", "society", "consequences", "fundamental rights"]),
    c("6.2", "AI objectives and plans to achieve them", "Measurable AI objectives consistent with the AI policy are set, with owners, resources, timelines and a way to evaluate results.", CLAUSES, ["objectives", "measurable", "targets", "plans", "KPIs", "owners"]),
    c("6.3", "Planning of changes to the AI management system", "Changes to the AI management system are planned and carried out in a controlled way.", CLAUSES, ["change management", "planned changes", "controlled", "change control"]),
    c("7.1", "Resources for the AI management system", "The people, infrastructure, data and tools needed to run and improve the AI management system are determined and provided.", CLAUSES, ["resources", "budget", "infrastructure", "staffing", "tooling"]),
    c("7.2", "Competence of people working with AI", "People whose work affects AI performance have the competence they need, gained through education, training or experience, and this is evidenced.", CLAUSES, ["competence", "training", "skills", "qualifications", "training records"]),
    c("7.3", "Awareness of the AI policy", "Staff and contractors know the AI policy, how they contribute to it and what happens when requirements are not met.", CLAUSES, ["awareness", "training", "AI policy", "staff", "contractors", "consequences"]),
    c("7.4", "Internal and external communication", "The organization decides what to communicate about AI, when, to whom and how, both internally and externally.", CLAUSES, ["communication", "internal communication", "external communication", "stakeholders", "disclosure"]),
    c("7.5", "Documented information", "Documents and records required by the system are created, identified, version-controlled, protected and retained.", CLAUSES, ["documented information", "document control", "version control", "records", "retention", "approval"], "policy_versioning"),
    c("8.1", "Operational planning and control", "Processes needed to meet AI requirements are planned, implemented and controlled with defined criteria, and outsourced processes are governed.", CLAUSES, ["operational control", "process criteria", "outsourced processes", "operational planning"]),
    c("8.2", "Performing AI risk assessments", "AI risk assessments are carried out at planned intervals and when significant changes occur, and the results are retained.", CLAUSES, ["risk assessment", "planned intervals", "significant changes", "reassessment", "records"]),
    c("8.3", "Implementing AI risk treatment", "The AI risk treatment plan is implemented and its results are retained as documented information.", CLAUSES, ["risk treatment plan", "implementation", "controls implemented", "evidence"]),
    c("8.4", "Performing AI system impact assessments", "AI system impact assessments are performed at planned intervals and on significant change, with retained results.", CLAUSES, ["impact assessment", "planned intervals", "significant change", "records"]),
    c("9.1", "Monitoring, measurement, analysis and evaluation", "The organization decides what to monitor and measure about its AI systems and management system, how, when and who evaluates the results.", CLAUSES, ["monitoring", "measurement", "metrics", "evaluation", "performance indicators", "analysis"], "monitoring"),
    c("9.2", "Internal audit of the AI management system", "Internal audits at planned intervals check that the AI management system conforms to requirements and is effectively implemented.", CLAUSES, ["internal audit", "audit programme", "audit criteria", "auditor", "nonconformities", "audit report"]),
    c("9.3", "Management review", "Top management reviews the AI management system at planned intervals, considering performance, risks, feedback and improvement opportunities.", CLAUSES, ["management review", "top management", "planned intervals", "review inputs", "decisions"]),
    c("10.1", "Continual improvement", "The suitability, adequacy and effectiveness of the AI management system are continually improved.", CLAUSES, ["continual improvement", "effectiveness", "lessons learned", "improvement"]),
    c("10.2", "Nonconformity and corrective action", "Nonconformities are reacted to, their causes analysed, corrective actions taken and their effectiveness reviewed, with records kept.", CLAUSES, ["nonconformity", "corrective action", "root cause", "effectiveness", "records"], "incident_management"),
    // Annex A
    c("A.2.2", "AI policy content", "A documented AI policy gives direction and support for developing and using AI in line with the organization's values, legal duties and risk appetite.", A2, ["AI policy", "principles", "values", "risk appetite", "legal requirements", "documented"], "policy_versioning"),
    c("A.2.3", "Alignment with other policies", "The AI policy is consistent with and cross-references related policies such as information security, privacy, quality and ethics.", A2, ["alignment", "information security policy", "privacy policy", "related policies", "consistency"]),
    c("A.2.4", "Review of the AI policy", "The AI policy is reviewed at planned intervals and after significant change to keep it suitable and effective.", A2, ["policy review", "reviewed annually", "planned intervals", "approved by", "version"], "policy_versioning"),
    c("A.3.2", "AI roles and responsibilities", "Roles and responsibilities for AI, including accountability for each AI system, are defined and allocated to named people or functions.", A3, ["roles", "responsibilities", "accountability", "AI system owner", "allocated", "named"], "access_control"),
    c("A.3.3", "Reporting of concerns about AI", "People can raise concerns about the organization's AI systems through a defined channel and are protected when they do so.", A3, ["reporting concerns", "whistleblowing", "speak up", "escalation", "channel", "protection"], "incident_management"),
    c("A.4.2", "Documentation of AI resources", "Resources needed for each AI system across its life cycle are identified and documented, including data, tools, compute and people.", A4, ["resource documentation", "inventory", "AI system inventory", "life cycle", "resources"], "agent_inventory"),
    c("A.4.3", "Data resources", "Information about the data used by AI systems, such as origin, categories and quality, is documented.", A4, ["data resources", "data inventory", "data categories", "training data", "documented"]),
    c("A.4.4", "Tooling resources", "Tools used to develop, deploy and operate AI systems, including models and libraries, are identified and documented.", A4, ["tooling", "tools", "models", "libraries", "frameworks", "documented"]),
    c("A.4.5", "System and computing resources", "Computing and system resources that AI systems depend on are identified and documented.", A4, ["computing resources", "infrastructure", "compute", "hosting", "capacity"]),
    c("A.4.6", "Human resources for AI", "The human skills and roles required for the AI life cycle, including oversight, are identified and documented.", A4, ["human resources", "skills", "expertise", "human oversight", "staffing"]),
    c("A.5.2", "AI system impact assessment process", "A documented process assesses the potential consequences of AI systems for individuals, groups and society before and during deployment.", A5, ["impact assessment", "process", "consequences", "deployment", "documented"]),
    c("A.5.3", "Documentation of impact assessments", "Results of AI system impact assessments are recorded and kept for a defined period.", A5, ["impact assessment", "documentation", "results", "retention", "records"]),
    c("A.5.4", "Impacts on individuals and groups", "Impact assessments consider effects on individuals and groups, such as fairness, safety, privacy and access to services.", A5, ["individuals", "groups", "fairness", "bias", "privacy", "safety", "discrimination"]),
    c("A.5.5", "Societal impacts", "Impact assessments consider broader effects on society, including environmental, economic and cultural consequences.", A5, ["societal impact", "society", "environment", "economic", "cultural"]),
    c("A.6.1.2", "Objectives for responsible development", "Objectives guiding responsible AI development are set and reflected in the development process.", A6, ["responsible development", "objectives", "development process", "trustworthy"]),
    c("A.6.1.3", "Processes for responsible design and development", "Defined processes govern how AI systems are designed and developed, covering stages, reviews and sign-offs.", A6, ["design", "development process", "life cycle", "reviews", "sign-off", "gates"]),
    c("A.6.2.2", "AI system requirements and specification", "Requirements for each AI system, including intended purpose and constraints, are specified and documented.", A6, ["requirements", "specification", "intended purpose", "constraints", "documented"], "agent_inventory"),
    c("A.6.2.3", "Design and development documentation", "Design choices, data, models and trade-offs made during development are documented.", A6, ["design documentation", "development records", "model card", "trade-offs", "architecture"]),
    c("A.6.2.4", "Verification and validation", "AI systems are tested against their requirements before release, using defined criteria, and the results are recorded.", A6, ["verification", "validation", "testing", "acceptance criteria", "test results", "evaluation"]),
    c("A.6.2.5", "Controlled deployment", "A deployment plan with approvals and criteria governs when and how AI systems go into production.", A6, ["deployment", "release", "approval", "approved by", "deployment plan", "go-live", "change approval"], "approval_workflow"),
    c("A.6.2.6", "Operation and monitoring of AI systems", "Deployed AI systems are operated according to documented procedures and monitored for performance, drift and misuse.", A6, ["operation", "monitoring", "drift", "performance", "alerts", "thresholds", "logging"], "monitoring"),
    c("A.6.2.7", "Technical documentation", "Technical documentation sufficient for users, auditors and regulators to understand the AI system is produced and maintained.", A6, ["technical documentation", "documentation", "maintained", "regulators", "auditors"]),
    c("A.6.2.8", "Event logging for AI systems", "AI systems automatically record events so their operation can be traced and investigated.", A6, ["event logs", "logging", "audit trail", "traceability", "tamper-evident", "retention"], "evidence_ledger"),
    c("A.7.2", "Data for development and enhancement", "Data management processes cover how data is used to develop and improve AI systems.", A7, ["data management", "training data", "development data", "data governance"]),
    c("A.7.3", "Acquisition of data", "Data is obtained through documented means that record its source, rights and conditions of use.", A7, ["data acquisition", "data source", "consent", "licensing", "rights", "classification"], "data_protection"),
    c("A.7.4", "Quality of data", "Criteria for data quality are defined and data is checked against them.", A7, ["data quality", "accuracy", "completeness", "representativeness", "quality criteria"]),
    c("A.7.5", "Data provenance", "The origin and processing history of data used by AI systems is recorded.", A7, ["data provenance", "lineage", "origin", "processing history", "traceability"]),
    c("A.7.6", "Data preparation", "Methods for preparing data, such as cleaning, labelling and transformation, are defined and documented.", A7, ["data preparation", "cleaning", "labelling", "transformation", "preprocessing"]),
    c("A.8.2", "System documentation and information for users", "Users receive the information they need to use the AI system appropriately, including its purpose, limitations and how to raise issues.", A8, ["user information", "documentation", "limitations", "instructions", "transparency"]),
    c("A.8.3", "External reporting", "A way exists for external parties to report adverse impacts of the organization's AI systems.", A8, ["external reporting", "adverse impacts", "complaints", "feedback channel", "public"]),
    c("A.8.4", "Communication of incidents", "Incidents involving AI systems are communicated to affected users and relevant authorities in a defined way.", A8, ["incident communication", "incident", "notification", "affected users", "authorities", "breach"], "incident_management"),
    c("A.8.5", "Information for interested parties", "Interested parties receive information about the organization's AI systems appropriate to their role and the obligations that apply.", A8, ["interested parties", "disclosure", "transparency", "obligations", "information"]),
    c("A.9.2", "Processes for responsible use of AI", "Documented processes govern how the organization uses AI systems responsibly, including human oversight and approval of consequential actions.", A9, ["responsible use", "human oversight", "approval", "human in the loop", "consequential actions", "acceptable use"], "approval_workflow"),
    c("A.9.3", "Objectives for responsible use", "Objectives for responsible use of AI are defined and guide operational decisions.", A9, ["responsible use", "objectives", "guiding principles", "operational decisions"]),
    c("A.9.4", "Intended use of the AI system", "AI systems are used only for their documented intended purpose and within stated constraints.", A9, ["intended use", "intended purpose", "constraints", "misuse", "scope of use"]),
    c("A.10.2", "Allocating responsibilities with third parties", "Responsibilities for AI across suppliers, partners and customers are allocated and documented.", A10, ["third parties", "responsibilities", "shared responsibility", "suppliers", "partners", "contracts"]),
    c("A.10.3", "Supplier management for AI", "A process makes sure that AI-related products and services from suppliers meet the organization's responsible AI requirements.", A10, ["suppliers", "vendors", "due diligence", "third-party risk", "contracts", "model provider"], "integration_security"),
    c("A.10.4", "Customer obligations", "The organization considers its customers' needs and obligations when providing AI systems or services.", A10, ["customers", "obligations", "service agreements", "customer requirements"]),
  ],
};
