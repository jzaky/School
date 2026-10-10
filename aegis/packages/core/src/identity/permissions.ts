/**
 * Permission catalog. Roles hold a list of these strings. "*" grants everything.
 * Keep the list flat and explicit so audits can read it.
 */
export const PERMISSIONS = {
  "org:read": "View organization settings",
  "org:admin": "Change organization settings, billing and SSO",
  "users:read": "View users and teams",
  "users:write": "Invite, change and remove users, teams and roles",
  "agents:read": "View AI agents",
  "agents:write": "Register and edit AI agents, tools and permissions",
  "agents:control": "Suspend, revoke, resume agents and revoke tool access (emergency controls)",
  "policies:read": "View policies and history",
  "policies:write": "Draft and edit policies",
  "policies:activate": "Approve, activate, deactivate and roll back policy versions",
  "gateway:read": "View action requests and decisions",
  "approvals:decide": "Approve, reject, escalate and reassign approval requests",
  "integrations:read": "View integrations",
  "integrations:write": "Manage integrations and rotate credentials",
  "evidence:read": "View and export the evidence ledger",
  "monitoring:read": "View alerts and risk monitoring",
  "monitoring:write": "Manage monitoring rules and resolve alerts",
  "security:read": "View security events and incidents",
  "security:write": "Manage data classes, tool security and incidents",
  "audit:read": "View assessments, documents and reports",
  "audit:write": "Upload documents, run assessments, manage remediation",
  "reports:read": "View and export governance reports",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface SystemRole {
  key: string;
  name: string;
  description: string;
  permissions: (Permission | "*")[];
}

export const SYSTEM_ROLES: SystemRole[] = [
  { key: "owner", name: "Owner", description: "Full control of the organization", permissions: ["*"] },
  {
    key: "admin",
    name: "Administrator",
    description: "Everything except billing and SSO changes",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "org:admin"),
  },
  {
    key: "governance_manager",
    name: "Governance Manager",
    description: "Owns policies, agents and approvals",
    permissions: ["org:read", "users:read", "agents:read", "agents:write", "agents:control", "policies:read", "policies:write", "policies:activate", "gateway:read", "approvals:decide", "integrations:read", "evidence:read", "monitoring:read", "monitoring:write", "security:read", "audit:read", "reports:read"],
  },
  {
    key: "approver",
    name: "Approver",
    description: "Decides approval requests within their authority",
    permissions: ["org:read", "agents:read", "policies:read", "gateway:read", "approvals:decide", "evidence:read", "reports:read"],
  },
  {
    key: "security_analyst",
    name: "Security Analyst",
    description: "Investigates security events and incidents, manages data protection",
    permissions: ["org:read", "users:read", "agents:read", "agents:control", "policies:read", "gateway:read", "approvals:decide", "integrations:read", "integrations:write", "evidence:read", "monitoring:read", "monitoring:write", "security:read", "security:write", "reports:read"],
  },
  {
    key: "auditor",
    name: "Auditor",
    description: "Read access everywhere plus assessment work",
    permissions: ["org:read", "users:read", "agents:read", "policies:read", "gateway:read", "integrations:read", "evidence:read", "monitoring:read", "security:read", "audit:read", "audit:write", "reports:read"],
  },
  {
    key: "engineer",
    name: "AI Engineer",
    description: "Registers agents and integrations, cannot approve or activate policies",
    permissions: ["org:read", "agents:read", "agents:write", "policies:read", "gateway:read", "integrations:read", "integrations:write", "evidence:read", "monitoring:read"],
  },
  { key: "viewer", name: "Viewer", description: "Read-only", permissions: ["org:read", "agents:read", "policies:read", "gateway:read", "evidence:read", "monitoring:read", "security:read", "audit:read", "reports:read"] },
];

export function hasPermission(granted: readonly string[] | undefined, needed: Permission): boolean {
  if (!granted) return false;
  return granted.includes("*") || granted.includes(needed);
}
