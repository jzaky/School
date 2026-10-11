export interface LifecycleAction {
  to: "draft" | "registered" | "active" | "suspended" | "revoked" | "archived";
  label: string;
  variant: "primary" | "secondary" | "danger" | "ghost";
  permission: "agents:write" | "agents:control";
  reason: boolean;
  typed?: string;
  warning?: string;
  description: string;
}

/** Presentation for each lifecycle target. The allowed set per status comes from core AGENT_TRANSITIONS. */
export const LIFECYCLE_ACTIONS: Record<LifecycleAction["to"], LifecycleAction> = {
  registered: { to: "registered", label: "Register", variant: "primary", permission: "agents:write", reason: false, description: "Marks the agent as registered. It still cannot call the gateway until activated." },
  active: { to: "active", label: "Activate", variant: "primary", permission: "agents:write", reason: false, description: "Allows the agent to submit action requests, subject to policy." },
  suspended: { to: "suspended", label: "Suspend", variant: "danger", permission: "agents:control", reason: true, description: "Blocks every gateway call immediately. Pending approvals stay pending." },
  revoked: { to: "revoked", label: "Revoke", variant: "danger", permission: "agents:control", reason: true, typed: "REVOKE", warning: "Revocation is irreversible. All API keys, tool grants and resource permissions are revoked and pending approvals expire. The only remaining transition is Archive.", description: "Permanently removes the agent's ability to act." },
  archived: { to: "archived", label: "Archive", variant: "ghost", permission: "agents:write", reason: false, description: "Hides the agent from day-to-day views. History is kept." },
  draft: { to: "draft", label: "Back to draft", variant: "ghost", permission: "agents:write", reason: false, description: "Returns a registered agent to draft." },
};
