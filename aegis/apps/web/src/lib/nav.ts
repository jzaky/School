import type { Permission } from "@aegis/core";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  Bot,
  Building2,
  CheckSquare,
  ClipboardList,
  Cpu,
  Database,
  FileCheck2,
  FileText,

  GitBranch,
  History,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Lock,
  Plug,
  Scale,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Stethoscope,
  Users,
  UsersRound,
  Wrench,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  ready: boolean;
  permission?: Permission;
  /** Only shown to platform administrators. */
  platformAdmin?: boolean;
  /** Needs an active organization (false for platform pages). */
  needsOrg?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  platformAdmin?: boolean;
}

export const NOT_READY_REASON = "Available in a later release of this build";

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Command Center", href: "/overview", icon: LayoutDashboard, ready: true },
      { label: "Live Activity", href: "/activity", icon: Activity, ready: false, permission: "gateway:read" },
      { label: "Alerts", href: "/alerts", icon: AlertTriangle, ready: false, permission: "monitoring:read" },
    ],
  },
  {
    label: "Control",
    items: [
      { label: "AI Agents", href: "/agents", icon: Bot, ready: true, permission: "agents:read" },
      { label: "Policies", href: "/policies", icon: Scale, ready: false, permission: "policies:read" },
      { label: "Action Gateway", href: "/gateway", icon: GitBranch, ready: false, permission: "gateway:read" },
      { label: "Approvals", href: "/approvals", icon: CheckSquare, ready: false, permission: "approvals:decide" },
      { label: "Integrations", href: "/integrations", icon: Plug, ready: true, permission: "integrations:read" },
    ],
  },
  {
    label: "Assurance",
    items: [
      { label: "Evidence Ledger", href: "/evidence", icon: ScrollText, ready: false, permission: "evidence:read" },
      { label: "Risk Monitoring", href: "/monitoring", icon: BarChart3, ready: false, permission: "monitoring:read" },
      { label: "Governance Reports", href: "/reports", icon: FileText, ready: false, permission: "reports:read" },
      { label: "Policy History", href: "/policy-history", icon: History, ready: false, permission: "policies:read" },
    ],
  },
  {
    label: "Shield",
    items: [
      { label: "Security Events", href: "/security/events", icon: ShieldAlert, ready: false, permission: "security:read" },
      { label: "Data Protection", href: "/security/data-protection", icon: Lock, ready: false, permission: "security:read" },
      { label: "Tool Security", href: "/security/tools", icon: Wrench, ready: false, permission: "security:read" },
      { label: "Incidents", href: "/security/incidents", icon: Siren, ready: false, permission: "security:read" },
    ],
  },
  {
    label: "Audit",
    items: [
      { label: "Assessments", href: "/audit/assessments", icon: ClipboardList, ready: false, permission: "audit:read" },
      { label: "Standards", href: "/audit/standards", icon: Landmark, ready: false, permission: "audit:read" },
      { label: "Documents", href: "/audit/documents", icon: FileCheck2, ready: false, permission: "audit:read" },
      { label: "Remediation", href: "/audit/remediation", icon: ListChecks, ready: false, permission: "audit:read" },
      { label: "Reports", href: "/audit/reports", icon: FileText, ready: false, permission: "audit:read" },
    ],
  },
  {
    label: "Organization",
    items: [
      { label: "Users", href: "/org/users", icon: Users, ready: true, permission: "users:read" },
      { label: "Teams", href: "/org/teams", icon: UsersRound, ready: true, permission: "users:read" },
      { label: "Roles", href: "/org/roles", icon: ShieldCheck, ready: true, permission: "users:read" },
      { label: "Settings", href: "/org/settings", icon: Settings, ready: true, permission: "org:read" },
      { label: "Billing", href: "/org/billing", icon: BadgeDollarSign, ready: true, permission: "org:read" },
    ],
  },
  {
    label: "Platform Admin",
    platformAdmin: true,
    items: [
      { label: "Tenants", href: "/platform/tenants", icon: Building2, ready: true, platformAdmin: true, needsOrg: false },
      { label: "Infrastructure Health", href: "/platform/health", icon: Stethoscope, ready: true, platformAdmin: true, needsOrg: false },
      { label: "System Events", href: "/platform/events", icon: Server, ready: true, platformAdmin: true, needsOrg: false },
      { label: "Deployment Versions", href: "/platform/versions", icon: Cpu, ready: true, platformAdmin: true, needsOrg: false },
      { label: "Operational Diagnostics", href: "/platform/diagnostics", icon: Database, ready: true, platformAdmin: true, needsOrg: false },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/overview") return pathname === "/overview";
  return pathname === href || pathname.startsWith(href + "/");
}

