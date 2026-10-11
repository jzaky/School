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
}
