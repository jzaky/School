/**
 * Dubai Electronic Security Center Information Security Regulation (ISR), version 3.
 *
 * The ISR applies to Dubai government entities and their suppliers and is organised in security
 * domains. AEGIS summarises the domains in original wording under its own identifiers (ISR-01 and
 * so on). The regulation's own control numbering and text are not reproduced; entities hold the
 * regulation and its numbering through DESC. This catalog is a working map, not the regulation.
 */
import { control as c, type FrameworkSeed } from "./types.js";

const GOV = "Governance and risk";
const PEOPLE = "People and assets";
const ACCESS = "Access and cryptography";
const OPS = "Operations and communications";
const DEV = "Acquisition, development and suppliers";
const RESP = "Incidents, continuity and compliance";

export const DESC_ISR: FrameworkSeed = {
  key: "desc-isr",
  name: "Dubai DESC Information Security Regulation (ISR) v3",
  version: "3 (domain summary)",
  publisher: "Dubai Electronic Security Center (summarised by AEGIS)",
  licenseNote: "The ISR is issued by the Dubai Electronic Security Center for Dubai government entities and their suppliers. AEGIS summarises its security domains in original wording under its own identifiers; the regulation's control numbering and text are not reproduced. Entities must work from the regulation as issued by DESC. Mapping an AEGIS record to a domain here is not a DESC compliance assessment.",
  description: "Domain-level map of the Dubai government information security regulation: governance, risk, assets, people, access, cryptography, operations, communications, development, suppliers, incidents, continuity and compliance, with the AI-agent controls AEGIS can evidence against each.",
  controls: [
    c("ISR-01", "Information security governance", "Leadership assigns ownership of information security, approves policies and reviews their effectiveness on a defined cycle.", GOV, ["governance", "leadership", "policy approval", "ownership", "management review"], "policy_versioning"),
    c("ISR-02", "Risk management", "Information security risks, including those from AI systems and automation, are identified, assessed, treated and reviewed with documented acceptance by risk owners.", GOV, ["risk assessment", "risk treatment", "risk register", "risk owner", "AI risk"]),
    c("ISR-03", "Asset management", "Information assets and the systems that process them, including AI agents and their tools, are inventoried, classified and assigned an owner.", PEOPLE, ["asset inventory", "classification", "ownership", "agents", "systems"], "agent_inventory"),
    c("ISR-04", "Human resources security", "Staff and contractors are screened, trained and bound by security responsibilities before, during and at the end of their engagement.", PEOPLE, ["screening", "training", "awareness", "contractors", "termination"]),
    c("ISR-05", "Physical and environmental security", "Facilities and equipment holding information are protected against unauthorised physical access and environmental hazards.", PEOPLE, ["physical security", "facilities", "equipment", "environmental"]),
    c("ISR-06", "Access control", "Access to systems and data is granted on business need, authenticated strongly, reviewed regularly and removed promptly, for people and for automated agents alike.", ACCESS, ["access control", "least privilege", "authentication", "MFA", "review", "revocation", "agents"], "access_control"),
    c("ISR-07", "Cryptography", "Cryptographic controls protect information in transit and at rest, and keys are generated, stored, rotated and retired under a documented process.", ACCESS, ["encryption", "key management", "rotation", "TLS", "at rest"], "integration_security"),
    c("ISR-08", "Operations security", "Operational procedures, change control, malware protection, logging, monitoring and vulnerability management keep production systems secure and their activity traceable.", OPS, ["operations", "change management", "logging", "monitoring", "vulnerability management", "audit trail"], "evidence_ledger"),
    c("ISR-09", "Communications security", "Networks and data in transit are segmented, protected and monitored, and transfers of information to third parties are controlled.", OPS, ["network security", "segmentation", "data transfer", "egress", "allowlist"], "data_protection"),
    c("ISR-10", "System acquisition, development and maintenance", "Security requirements are built into systems that are bought or developed, changes are tested, and test data is protected.", DEV, ["secure development", "requirements", "testing", "change control", "SDLC"]),
    c("ISR-11", "Supplier and third-party security", "Suppliers and cloud providers are assessed, bound by security requirements in contracts and monitored for the duration of the relationship.", DEV, ["supplier", "third party", "cloud", "contract", "monitoring"], "integration_security"),
    c("ISR-12", "Information security incident management", "Security events are detected, reported, assessed, responded to and learned from under a defined process with records kept.", RESP, ["incident management", "detection", "response", "reporting", "lessons learned"], "incident_management"),
    c("ISR-13", "Business continuity", "Information security is maintained through disruption with tested continuity and recovery arrangements.", RESP, ["business continuity", "disaster recovery", "backup", "testing"]),
    c("ISR-14", "Compliance and audit", "Legal, regulatory and contractual obligations are identified and met, and independent reviews and audits check that controls operate as intended.", RESP, ["compliance", "audit", "legal", "regulatory", "independent review"], "security_events"),
    c("ISR-15", "Monitoring and reporting to DESC", "Security posture and incidents are monitored and reported to the regulator as required, with evidence available on request.", RESP, ["reporting", "regulator", "monitoring", "evidence", "DESC"], "monitoring"),
  ],
};
