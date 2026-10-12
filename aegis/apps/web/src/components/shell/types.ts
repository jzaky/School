export interface ShellMembership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgDemo: boolean;
  roleName: string;
}

export interface ShellData {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  org: { id: string; slug: string; name: string; demoMode: boolean } | null;
  roleName: string | null;
  memberships: ShellMembership[];
  permissions: string[];
  unread: number;
  /** Approvals waiting for a decision, shown on the Approvals nav item. */
  pendingApprovals?: number;
  /** Onboarding progress; the Getting started link shows while steps remain and nobody dismissed it. */
  onboarding?: { done: number; total: number; dismissed: boolean };
}
