/**
 * Further ISO/IEC catalogs relevant to AI governance, privacy and cloud security.
 *
 * Only clause and annex identifiers are referenced. Titles and summaries are original AEGIS wording
 * describing each objective; no text of any standard is reproduced. Customers need their own
 * licensed copies.
 */
import { control as c, type FrameworkSeed } from "./types.js";

const ISO_NOTE = (name: string) => `${name} is copyrighted by ISO and IEC. AEGIS references clause and annex identifiers only; every title and summary is original AEGIS wording describing the objective and is not the text of the standard. Customers must hold their own licensed copy to interpret and implement it.`;

export const ISO_23894: FrameworkSeed = {
  key: "iso-23894",
  name: "ISO/IEC 23894:2023 AI risk management",
  version: "2023",
  publisher: "ISO/IEC",
  licenseNote: ISO_NOTE("ISO/IEC 23894:2023"),
  description: "Guidance for managing the risks an organization faces from developing or using AI, following the ISO 31000 structure of principles, framework and process, with AI-specific risk sources.",
  controls: [
    c("5", "Risk management principles applied to AI", "Risk management for AI is integrated, structured, customised, inclusive, dynamic, evidence-based and attentive to human factors, as the ISO 31000 principles require.", "Clause 5 Principles", ["principles", "integrated", "inclusive", "dynamic", "human factors"]),
    c("6.1", "Leadership and commitment", "Leadership owns the AI risk management framework, assigns accountability and resources and aligns it with the organization's objectives and values.", "Clause 6 Framework", ["leadership", "commitment", "accountability", "resources"]),
    c("6.2", "Integration into organizational processes", "AI risk management is embedded in governance, decision-making and the AI life cycle rather than run as a separate exercise.", "Clause 6 Framework", ["integration", "governance", "decision-making", "life cycle"]),
    c("6.3", "Design of the framework", "The organization understands its context, articulates its commitment, assigns roles, allocates resources and sets up communication for AI risk.", "Clause 6 Framework", ["framework design", "context", "roles", "communication"]),
    c("6.4", "Implementation, evaluation and improvement", "The framework is put into practice, its effectiveness is measured and it is improved over time.", "Clause 6 Framework", ["implementation", "evaluation", "improvement", "effectiveness"]),
    c("6.5.2", "Communication and consultation", "Internal and external stakeholders are consulted and informed throughout the AI risk process.", "Clause 6 Process", ["communication", "consultation", "stakeholders"]),
    c("6.5.3", "Scope, context and criteria", "The scope of AI risk management, the internal and external context and the criteria for evaluating AI risk are defined.", "Clause 6 Process", ["scope", "context", "risk criteria"]),
    c("6.5.4.2", "Risk identification for AI", "Sources of AI risk such as autonomy level, opacity, data quality, system complexity, environment and human factors are identified for each system.", "Clause 6 Process", ["risk identification", "autonomy", "opacity", "complexity", "data quality"]),
    c("6.5.4.3", "Risk analysis", "Likelihood and consequences of identified AI risks are analysed, considering uncertainty and the effectiveness of existing controls.", "Clause 6 Process", ["risk analysis", "likelihood", "consequence", "controls"]),
    c("6.5.4.4", "Risk evaluation", "Analysed AI risks are compared with the criteria to decide which need treatment and in what priority.", "Clause 6 Process", ["risk evaluation", "prioritisation", "criteria"]),
    c("6.5.5", "Risk treatment", "Treatment options are chosen and implemented, including controls over autonomy, human oversight and monitoring, with residual risk accepted by its owner.", "Clause 6 Process", ["risk treatment", "controls", "human oversight", "residual risk"], "approval_workflow"),
    c("6.5.6", "Monitoring and review", "AI risks and the controls over them are monitored and reviewed as systems, data and context change.", "Clause 6 Process", ["monitoring", "review", "change"], "monitoring"),
    c("6.5.7", "Recording and reporting", "The risk process and its outcomes are recorded and reported to decision makers and stakeholders.", "Clause 6 Process", ["records", "reporting", "documentation"], "evidence_ledger"),
    c("Annex A", "AI objectives and risk sources", "The organization uses the standard's catalogue of AI objectives, such as fairness, safety, security, transparency and accountability, and of AI-specific risk sources to structure its assessments.", "Annexes", ["objectives", "risk sources", "fairness", "safety", "accountability"]),
  ],
};

export const ISO_27701: FrameworkSeed = {
  key: "iso-27701",
  name: "ISO/IEC 27701:2019 Privacy information management",
  version: "2019",
  publisher: "ISO/IEC",
  licenseNote: ISO_NOTE("ISO/IEC 27701:2019"),
  description: "Extension of ISO/IEC 27001 and 27002 for privacy information management, with controller and processor controls for personally identifiable information.",
  controls: [
    c("5.2.1", "Context includes privacy obligations", "The organization identifies the privacy laws, regulations, contracts and interested parties that shape its PII processing.", "Clause 5 PIMS-specific requirements", ["context", "privacy law", "regulations", "interested parties"]),
    c("5.4.1.2", "Privacy risk assessment", "Risks to PII principals from the organization's processing are assessed alongside information security risks.", "Clause 5 PIMS-specific requirements", ["privacy risk", "risk assessment", "PII principal"]),
    c("6.2.1.1", "Privacy policy", "A privacy policy, aligned with the information security policy, states the organization's commitment and rules for PII processing.", "Clause 6 PIMS-specific guidance", ["privacy policy", "commitment", "rules"], "policy_versioning"),
    c("6.9.4.1", "Event logging covers PII access", "Logs record access to and changes of PII so that use can be traced and reviewed.", "Clause 6 PIMS-specific guidance", ["logging", "PII access", "audit trail"], "evidence_ledger"),
    c("6.13.1.5", "Privacy breach response", "Responsibilities and procedures for PII breaches, including notification duties, are in place and exercised.", "Clause 6 PIMS-specific guidance", ["breach", "notification", "response"], "incident_management"),
    c("7.2.1", "Purpose identified and documented", "Each purpose of PII processing is identified and documented before processing begins.", "Annex A Controller controls", ["purpose", "documented", "controller"]),
    c("7.2.2", "Lawful basis identified", "The lawful basis for each processing purpose is identified and recorded.", "Annex A Controller controls", ["lawful basis", "consent", "controller"]),
    c("7.2.5", "Privacy impact assessment", "A privacy impact assessment is carried out when new processing or changes could affect PII principals.", "Annex A Controller controls", ["privacy impact assessment", "PIA", "DPIA", "change"]),
    c("7.3.6", "Access, correction and erasure", "PII principals can access, correct and have erased their PII, and requests are handled within defined times.", "Annex A Controller controls", ["access", "correction", "erasure", "requests"]),
    c("7.4.1", "Collection limited to purpose", "PII collection is limited to what is relevant, proportional and necessary for the identified purposes.", "Annex A Controller controls", ["minimisation", "collection", "purpose"], "data_protection"),
    c("7.4.5", "De-identification and deletion at end of processing", "PII is deleted or de-identified as soon as the purpose no longer requires it.", "Annex A Controller controls", ["deletion", "de-identification", "retention"]),
    c("7.5.1", "Transfer basis identified", "The basis for transferring PII between jurisdictions is identified and documented.", "Annex A Controller controls", ["transfer", "jurisdiction", "international"]),
    c("8.2.2", "Processing on documented instructions", "A processor processes PII only on the customer's documented instructions and under a contract that sets out the roles and obligations.", "Annex B Processor controls", ["processor", "instructions", "contract"], "integration_security"),
    c("8.4.2", "Return, transfer or disposal of PII", "At the end of processing, PII is returned, transferred or securely disposed of as the contract requires.", "Annex B Processor controls", ["return", "disposal", "end of contract"]),
    c("8.5.6", "Disclosure of subcontractors", "Subcontractors that process PII are disclosed to the customer in advance, with the chance to object.", "Annex B Processor controls", ["subcontractor", "disclosure", "sub-processor"]),
  ],
};

export const ISO_27017: FrameworkSeed = {
  key: "iso-27017",
  name: "ISO/IEC 27017:2015 Cloud security controls",
  version: "2015",
  publisher: "ISO/IEC",
  licenseNote: ISO_NOTE("ISO/IEC 27017:2015"),
  description: "Cloud-specific guidance on ISO/IEC 27002 controls plus additional controls for cloud service customers and providers.",
  controls: [
    c("6.1.1", "Roles shared between customer and provider", "Information security responsibilities are divided explicitly between the cloud customer and the cloud provider and recorded.", "Organization of information security", ["shared responsibility", "roles", "cloud customer", "cloud provider"]),
    c("CLD.6.3.1", "Shared roles and responsibilities within a cloud service", "Each party knows which security controls it operates and which it relies on the other for.", "Organization of information security", ["shared responsibility", "controls", "cloud"]),
    c("CLD.8.1.5", "Removal of customer assets at termination", "Customer assets are returned or removed from the provider's environment when the service ends.", "Asset management", ["termination", "removal", "assets", "return"]),
    c("9.2.1", "User registration in cloud services", "Cloud customer users and the provider's administrators are registered and de-registered under a controlled process.", "Access control", ["user registration", "de-registration", "administrators"], "access_control"),
    c("CLD.9.5.1", "Segregation in virtual computing environments", "A customer's virtual environment is protected from other customers and unauthorised persons.", "Access control", ["segregation", "multi-tenant", "isolation", "virtual environment"]),
    c("CLD.9.5.2", "Virtual machine hardening", "Virtual machines are configured to the security requirements of their role.", "Access control", ["hardening", "virtual machine", "configuration"]),
    c("CLD.12.1.5", "Administrator operational security", "Procedures define how cloud administration is performed securely, including privileged operations.", "Operations security", ["administration", "privileged", "procedures"]),
    c("CLD.12.4.5", "Monitoring of cloud services", "The customer can monitor the aspects of the cloud service relevant to its security, and the provider supports that monitoring.", "Operations security", ["monitoring", "visibility", "logs"], "monitoring"),
    c("CLD.13.1.4", "Alignment of virtual and physical network security", "Security policies for virtual networks match those for the physical networks they run on.", "Communications security", ["network", "virtual network", "policy alignment"]),
    c("15.1.2", "Supplier agreements for cloud services", "Agreements with cloud providers cover security requirements, incident reporting, data location and termination.", "Supplier relationships", ["supplier agreement", "cloud provider", "incident reporting", "data location"], "integration_security"),
  ],
};

export const ISO_27018: FrameworkSeed = {
  key: "iso-27018",
  name: "ISO/IEC 27018:2019 PII protection in public clouds",
  version: "2019",
  publisher: "ISO/IEC",
  licenseNote: ISO_NOTE("ISO/IEC 27018:2019"),
  description: "Controls for public cloud providers acting as PII processors, structured by the privacy principles of ISO/IEC 29100.",
  controls: [
    c("A.2", "Consent and choice", "The provider processes PII only on the customer's instructions and supports the customer in honouring the principal's consent and choices, including for marketing.", "Annex A Public cloud PII processor controls", ["consent", "choice", "instructions", "marketing"]),
    c("A.3", "Purpose legitimacy and specification", "PII is processed only for the purposes the customer specifies and never for the provider's own purposes.", "Annex A Public cloud PII processor controls", ["purpose", "legitimacy", "provider purposes"]),
    c("A.4", "Collection limitation", "The provider does not collect PII beyond what the service needs to operate.", "Annex A Public cloud PII processor controls", ["collection", "limitation"]),
    c("A.5", "Data minimisation", "Temporary files and documents holding PII are erased or de-identified within a defined period, and PII is minimised in logs and support records.", "Annex A Public cloud PII processor controls", ["minimisation", "temporary files", "logs", "erasure"], "data_protection"),
    c("A.6", "Use, retention and disclosure limitation", "PII is not disclosed to third parties or law enforcement without the customer's knowledge unless legally barred from telling them, and is retained only as long as the service requires.", "Annex A Public cloud PII processor controls", ["disclosure", "retention", "law enforcement", "third parties"]),
    c("A.7", "Accuracy and quality", "The provider supports the customer in keeping PII accurate and complete.", "Annex A Public cloud PII processor controls", ["accuracy", "quality"]),
    c("A.8", "Openness, transparency and notice", "Sub-processors, data locations and the provider's processing are disclosed to the customer before the contract and when they change.", "Annex A Public cloud PII processor controls", ["transparency", "sub-processors", "data location", "notice"]),
    c("A.9", "Individual participation and access", "The provider supports the customer in giving principals access to, correction of and deletion of their PII.", "Annex A Public cloud PII processor controls", ["access", "correction", "deletion", "principals"]),
    c("A.10", "Accountability", "Breaches affecting PII are notified to the customer promptly, retention and disposal are documented, and staff handling PII are under confidentiality obligations.", "Annex A Public cloud PII processor controls", ["breach notification", "confidentiality", "accountability", "disposal"], "incident_management"),
    c("A.11", "Information security for PII", "Access to PII is restricted and logged, data is encrypted in transit and where appropriate at rest, and storage media are handled securely.", "Annex A Public cloud PII processor controls", ["access control", "encryption", "logging", "media"], "access_control"),
    c("A.12", "Privacy compliance", "The provider's compliance with its PII obligations is reviewed independently, and the geographic location of PII is disclosed.", "Annex A Public cloud PII processor controls", ["compliance", "independent review", "location"]),
  ],
};

export const ISO_42005: FrameworkSeed = {
  key: "iso-42005",
  name: "ISO/IEC 42005:2025 AI system impact assessment",
  version: "2025",
  publisher: "ISO/IEC",
  licenseNote: ISO_NOTE("ISO/IEC 42005:2025"),
  description: "Guidance for assessing the impacts an AI system may have on individuals, groups and society, and for integrating that assessment into the AI life cycle.",
  controls: [
    c("5.2", "Integration into the AI management system", "Impact assessment is a defined step in the organization's AI processes rather than an ad hoc exercise.", "Clause 5 Approach", ["integration", "process", "management system"]),
    c("5.3", "Timing of the assessment", "Impact assessments are performed before deployment and repeated when the system, its use or its context changes materially.", "Clause 5 Approach", ["timing", "before deployment", "change", "reassessment"]),
    c("5.4", "Scope of the assessment", "The assessment's boundaries cover the system, its uses, the people affected and the deployment context.", "Clause 5 Approach", ["scope", "boundaries", "affected people"]),
    c("5.5", "Roles and responsibilities", "Accountable owners, assessors and reviewers are named for each assessment.", "Clause 5 Approach", ["roles", "accountable owner", "reviewer"]),
    c("5.6", "Thresholds for action", "Criteria define which impact levels require mitigation, escalation or a decision not to deploy.", "Clause 5 Approach", ["thresholds", "criteria", "escalation", "no-go"]),
    c("6.2", "System description", "The assessment records the system's purpose, functionality, autonomy, data, models, interfaces and the actions it can take.", "Clause 6 Process", ["system description", "purpose", "autonomy", "actions", "tools"], "agent_inventory"),
    c("6.3", "Deployment context", "The environment, users, operators and affected parties of the deployment are described.", "Clause 6 Process", ["context", "users", "affected parties", "environment"]),
    c("6.4", "Identification of impacts", "Potential benefits and harms to individuals, groups and society, including rights, safety, economic and environmental effects, are identified.", "Clause 6 Process", ["impacts", "harms", "benefits", "rights", "safety"]),
    c("6.5", "Analysis and mitigation", "Impacts are analysed for likelihood and severity and mitigations such as controls on autonomy, oversight and monitoring are chosen and recorded.", "Clause 6 Process", ["analysis", "mitigation", "oversight", "controls"], "approval_workflow"),
    c("6.6", "Approval, communication and monitoring", "The assessment outcome is approved by the accountable owner, communicated to stakeholders and kept current through monitoring.", "Clause 6 Process", ["approval", "communication", "monitoring", "review"], "monitoring"),
  ],
};

export const ISO_38507: FrameworkSeed = {
  key: "iso-38507",
  name: "ISO/IEC 38507:2022 Governance implications of AI",
  version: "2022",
  publisher: "ISO/IEC",
  licenseNote: ISO_NOTE("ISO/IEC 38507:2022"),
  description: "Guidance for governing bodies on the oversight, strategy, policy and accountability implications of an organization's use of AI.",
  controls: [
    c("5.2", "Governing body oversight of AI", "The governing body understands where AI is used, its risks and benefits, and oversees its use as part of its governance duties.", "Clause 5 Governance of AI", ["board", "oversight", "governing body", "AI use"], "agent_inventory"),
    c("5.3", "AI strategy aligned with organizational purpose", "The use of AI is directed by a strategy consistent with the organization's purpose, values and risk appetite.", "Clause 5 Governance of AI", ["strategy", "purpose", "values", "risk appetite"]),
    c("5.4", "AI policies set by the governing body", "Policies for acceptable AI use, decision rights and constraints on automation are set and reviewed by the governing body.", "Clause 5 Governance of AI", ["policy", "acceptable use", "decision rights", "constraints"], "policy_versioning"),
    c("6.2", "Accountability for AI decisions", "Accountability for decisions and actions taken with AI remains with identified people and is not delegated to the system.", "Clause 6 Implications", ["accountability", "human responsibility", "delegation"], "approval_workflow"),
    c("6.3", "Risk and control", "AI-specific risks, including autonomous action and opacity, are covered by the organization's risk management and controls.", "Clause 6 Implications", ["risk", "controls", "autonomy", "opacity"]),
    c("6.4", "Data governance", "Data used and produced by AI is governed for quality, rights, privacy and security.", "Clause 6 Implications", ["data governance", "quality", "privacy", "security"], "data_protection"),
    c("6.5", "Culture, competence and communication", "The organization builds the competence and culture needed to use AI responsibly and communicates its use to stakeholders.", "Clause 6 Implications", ["culture", "competence", "communication", "transparency"]),
    c("6.6", "Compliance and reporting", "The governing body receives assurance that AI use complies with law and policy and is reported on with evidence.", "Clause 6 Implications", ["compliance", "assurance", "reporting", "evidence"], "evidence_ledger"),
  ],
};
