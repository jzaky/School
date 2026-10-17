/**
 * UAE Personal Data Protection Law, Federal Decree-Law No. 45 of 2021.
 *
 * Summarised by principle in original AEGIS wording. Article numbering is deliberately not cited:
 * the executive regulations and the UAE Data Office's guidance determine the operative detail, and
 * the free zones (DIFC, ADGM) run their own regimes. Not legal advice.
 */
import { control as c, type FrameworkSeed } from "./types.js";

const SCOPE = "Scope and principles";
const BASIS = "Lawful basis";
const DUTIES = "Controller and processor duties";
const RIGHTS = "Rights of the data subject";
const SECURITY = "Security and breaches";
const TRANSFER = "Cross-border transfer";

export const UAE_PDPL: FrameworkSeed = {
  key: "uae-pdpl",
  name: "UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021)",
  version: "2021",
  publisher: "United Arab Emirates (summarised by AEGIS)",
  licenseNote: "The law is published by the UAE government. AEGIS summarises its obligations by principle in original wording and does not cite article numbers, because the executive regulations and the UAE Data Office's guidance determine the operative detail. DIFC and ADGM apply their own data protection regimes. Not legal advice.",
  description: "Federal personal data protection obligations in the UAE: lawful basis and consent, processing principles, controller and processor duties, records, data protection officers, data subject rights, security, breach notification and cross-border transfer.",
  controls: [
    c("PDPL-01", "Scope established", "The organization has determined which of its processing falls under the federal law, which falls under a free-zone regime and which is excluded, and records that determination.", SCOPE, ["scope", "applicability", "free zone", "DIFC", "ADGM", "exclusions"]),
    c("PDPL-02", "Processing principles", "Personal data is processed fairly, lawfully and transparently, for specified purposes, limited to what is needed, kept accurate and retained only as long as the purpose requires.", SCOPE, ["principles", "fairness", "purpose limitation", "data minimisation", "accuracy", "retention"]),
    c("PDPL-03", "Lawful basis identified", "Each processing activity rests on consent or on one of the other grounds the law allows, such as a contract, a legal obligation or the protection of a public or vital interest, and the basis is recorded.", BASIS, ["lawful basis", "consent", "contract", "legal obligation", "grounds"]),
    c("PDPL-04", "Consent is clear, specific and withdrawable", "Where consent is relied on it is obtained in a clear and specific way, the person is told the purpose and can withdraw it easily, and the organization can show it was given.", BASIS, ["consent", "withdraw", "specific", "demonstrable"]),
    c("PDPL-05", "Sensitive data safeguarded", "Data revealing health, beliefs, origin, biometrics or similar is processed only where the law permits and with heightened safeguards.", BASIS, ["sensitive data", "health", "biometric", "safeguards"], "data_protection"),
    c("PDPL-06", "Controller accountability", "The controller implements and can demonstrate appropriate technical and organizational measures, policies and training for the processing it decides on.", DUTIES, ["controller", "accountability", "policies", "measures", "training"], "policy_versioning"),
    c("PDPL-07", "Processor bound by contract and instructions", "Processors act only on the controller's documented instructions under a contract that fixes the processing, its security, confidentiality, sub-processing and the return or deletion of data.", DUTIES, ["processor", "contract", "instructions", "sub-processor", "deletion"], "integration_security"),
    c("PDPL-08", "Records of processing", "The controller and processor keep records of their processing activities, including purposes, categories, recipients, transfers, retention and security measures.", DUTIES, ["records of processing", "register", "inventory"], "agent_inventory"),
    c("PDPL-09", "Data protection officer where required", "A data protection officer with sufficient expertise is appointed where the law requires one, for example for high-risk or large-scale processing, and is reachable by the Data Office and data subjects.", DUTIES, ["data protection officer", "DPO", "appointment", "high risk"]),
    c("PDPL-10", "Impact assessment for high-risk processing", "Processing that uses new technology or is likely to pose a high risk to people, including profiling and automated decisions, is assessed in advance for risks and safeguards.", DUTIES, ["impact assessment", "DPIA", "high risk", "new technology", "profiling"]),
    c("PDPL-11", "Privacy notice and transparency", "Before or at collection people are told who processes their data, why, on what basis, who receives it, where it goes, how long it is kept and what rights they have.", RIGHTS, ["privacy notice", "transparency", "information", "purposes"]),
    c("PDPL-12", "Access, correction, erasure and restriction", "People can obtain their data and related information, have inaccurate data corrected, have data erased when no longer needed and restrict processing in defined cases, within the time the regulations set.", RIGHTS, ["access", "correction", "erasure", "restriction", "data subject request"]),
    c("PDPL-13", "Portability and objection", "People can receive their data in a structured machine-readable form and move it to another controller, and can object to processing including direct marketing.", RIGHTS, ["portability", "object", "direct marketing", "machine-readable"]),
    c("PDPL-14", "Automated decisions can be challenged", "A person is not subject to a decision with legal or similarly serious effect based only on automated processing without the right to human review and to contest it, unless an exception applies.", RIGHTS, ["automated decision", "profiling", "human review", "contest", "AI decision"], "approval_workflow"),
    c("PDPL-15", "Security measures", "Technical and organizational measures proportionate to the risk, such as encryption, access control, pseudonymisation and testing, protect personal data in transit and at rest.", SECURITY, ["security", "encryption", "access control", "pseudonymisation"], "access_control"),
    c("PDPL-16", "Breach notification", "A breach likely to harm people's privacy or rights is notified to the Data Office, and to the affected people where the harm is serious, within the time the regulations set, and every breach is documented.", SECURITY, ["breach", "notification", "Data Office", "documented"], "incident_management"),
    c("PDPL-17", "Cross-border transfer conditions", "Personal data leaves the UAE only to a jurisdiction with adequate protection or under safeguards the law and regulations allow, such as contractual commitments or explicit consent.", TRANSFER, ["cross-border transfer", "adequacy", "safeguards", "contractual", "international"]),
  ],
};
