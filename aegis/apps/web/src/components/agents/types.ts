export interface AgentToolRow {
  toolId: string;
  key: string;
  name: string;
  description: string;
  riskLevel: string;
  integration: string | null;
  enabled: boolean;
  toolEnabled: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
}

export interface AgentPermissionRow {
  id: string;
  resourceId: string;
  resourceKey: string;
  resourceName: string;
  classification: string;
  actions: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AgentVersionRow {
  id: string;
  version: number;
  manifest: string;
  notes: string;
  deployedAt: string | null;
  createdAt: string;
  createdBy: string;
  current: boolean;
}

export interface AgentKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CatalogTool {
  id: string;
  key: string;
  name: string;
  riskLevel: string;
  enabled: boolean;
  integration: string | null;
}

export interface CatalogResource {
  id: string;
  key: string;
  name: string;
  type: string;
  classification: string;
}

export interface AgentCaps {
  canWrite: boolean;
  canControl: boolean;
  editable: boolean;
  status: string;
}
