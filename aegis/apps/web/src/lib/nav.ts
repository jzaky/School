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
  ClipboardCheck,
  ClipboardList,
  Cpu,
  Database,
  FileCheck2,
  FileText,
  FlaskConical,
  Gavel,
  GitBranch,
  HeartPulse,
  LifeBuoy,
  Briefcase,
  Presentation,
  Flag,
  History,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Lock,
  Plug,
  Rocket,
  Scale,
  ScrollText,
  Send,
  Server,
  Settings,
  ShieldAlert,
  Store,
  ShieldCheck,
  Siren,
  Stethoscope,
  Users,
  UsersRound,
  Wrench,
  Radar,
  Gauge,
  CircleHelp,
  MessagesSquare,
  ScanEye,
  PackageCheck,
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
  /** Shell data field whose count is shown as a badge. */
  badge?: "pendingApprovals";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  platformAdmin?: boolean;
}

export const NOT_READY_REASON = "Available in a later release of this build";

/** Shown above Overview only while onboarding is incomplete and not dismissed (see ShellData.onboarding). */
export const GETTING_STARTED: NavItem = { label: "Getting started", href: "/getting-started", icon: Rocket, ready: true, permission: "org:read" };

/** The five everyday sections, always visible in the sidebar. */
export const PRIMARY_NAV: NavItem[] = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard, ready: true },
  { label: "Agents", href: "/agents", icon: Bot, ready: true, permission: "agents:read" },
  { label: "Approvals", href: "/approvals", icon: CheckSquare, ready: true, permission: "gateway:read", badge: "pendingApprovals" },
  { label: "Activity", href: "/activity", icon: Activity, ready: true, permission: "gateway:read" },
  { label: "Settings", href: "/org/settings", icon: Settings, ready: true, permission: "org:read" },
];

/** Specialist sections, collapsed under "More" by default. */
export const SECONDARY_NAV: NavGroup[] = [
  {
    label: "Command",
    items: [
      { label: "Control Center", href: "/control-center", icon: Radar, ready: true, permission: "org:read" },
      { label: "System Health", href: "/org/health", icon: HeartPulse, ready: true, permission: "org:read" },
      { label: "Sales Demo", href: "/sales-demo", icon: Presentation, ready: true, permission: "gateway:read" },
      { label: "Pilots", href: "/pilots", icon: Flag, ready: true, permission: "reports:read" },
    ],
  },
  {
    label: "Control",
    items: [
      { label: "Policies", href: "/policies", icon: Scale, ready: true, permission: "policies:read" },
      { label: "Action Gateway", href: "/gateway", icon: GitBranch, ready: true, permission: "gateway:read" },
      { label: "Integrations", href: "/integrations", icon: Plug, ready: true, permission: "integrations:read" },
      { label: "Marketplace", href: "/integrations/marketplace", icon: Store, ready: true, permission: "integrations:read" },
      { label: "Event Destinations", href: "/integrations/destinations", icon: Send, ready: true, permission: "integrations:read" },
      { label: "Autonomy", href: "/agents/autonomy", icon: Gauge, ready: true, permission: "agents:read" },
      { label: "Agent Discovery", href: "/agents/discovery", icon: Radar, ready: true, permission: "agents:read" },
      { label: "Access Reviews", href: "/agents/access-reviews", icon: ClipboardCheck, ready: true, permission: "agents:read" },
      { label: "Models", href: "/governance/models", icon: Cpu, ready: true, permission: "agents:read" },
      { label: "Alerts", href: "/alerts", icon: AlertTriangle, ready: true, permission: "monitoring:read" },
    ],
  },
  {
    label: "Assurance",
    items: [
      { label: "Evidence Ledger", href: "/evidence", icon: ScrollText, ready: true, permission: "evidence:read" },
      { label: "Risk Monitoring", href: "/monitoring", icon: BarChart3, ready: true, permission: "monitoring:read" },
      { label: "Uncertainty", href: "/uncertainty", icon: CircleHelp, ready: true, permission: "monitoring:read" },
      { label: "Governance Reports", href: "/reports", icon: FileText, ready: true, permission: "reports:read" },
      { label: "Policy History", href: "/policy-history", icon: History, ready: true, permission: "policies:read" },
    ],
  },
  {
    label: "Security",
    items: [
      { label: "Security Events", href: "/security/events", icon: ShieldAlert, ready: true, permission: "security:read" },
      { label: "Data Protection", href: "/security/data-protection", icon: Lock, ready: true, permission: "security:read" },
      { label: "AI Gateway", href: "/security/ai-gateway", icon: MessagesSquare, ready: true, permission: "security:read" },
      { label: "Shadow AI", href: "/security/shadow-ai", icon: ScanEye, ready: true, permission: "security:read" },
      { label: "Software Security", href: "/security/software", icon: PackageCheck, ready: true, permission: "org:read" },
      { label: "Tool Security", href: "/security/tools", icon: Wrench, ready: true, permission: "security:read" },
      { label: "Incidents", href: "/security/incidents", icon: Siren, ready: true, permission: "security:read" },
      { label: "Attack Simulation Lab", href: "/security/lab", icon: FlaskConical, ready: true, permission: "security:read" },
      { label: "Data Inventory", href: "/governance/data", icon: Database, ready: true, permission: "security:read" },
    ],
  },
  {
    label: "Audit",
    items: [
      { label: "Assessments", href: "/audit/assessments", icon: ClipboardList, ready: true, permission: "audit:read" },
      { label: "Standards", href: "/audit/standards", icon: Landmark, ready: true, permission: "audit:read" },
      { label: "Documents", href: "/audit/documents", icon: FileCheck2, ready: true, permission: "audit:read" },
      { label: "Remediation", href: "/audit/remediation", icon: ListChecks, ready: true, permission: "audit:read" },
      { label: "Regulatory Changes", href: "/governance/regulatory", icon: Gavel, ready: true, permission: "audit:read" },
      { label: "Reports", href: "/audit/reports", icon: FileText, ready: true, permission: "audit:read" },
    ],
  },
  {
    label: "Organization",
    items: [
      { label: "Users", href: "/org/users", icon: Users, ready: true, permission: "users:read" },
      { label: "Teams", href: "/org/teams", icon: UsersRound, ready: true, permission: "users:read" },
      { label: "Roles", href: "/org/roles", icon: ShieldCheck, ready: true, permission: "users:read" },
      { label: "Billing", href: "/org/billing", icon: BadgeDollarSign, ready: true, permission: "org:read" },
      { label: "Deployment", href: "/org/deployment", icon: Server, ready: true, permission: "org:read" },
      { label: "Support", href: "/org/support", icon: LifeBuoy, ready: true, permission: "org:read" },
    ],
  },
  {
    label: "Platform Admin",
    platformAdmin: true,
    items: [
      { label: "Tenants", href: "/platform/tenants", icon: Building2, ready: true, platformAdmin: true, needsOrg: false },
      { label: "Customers", href: "/platform/customers", icon: Briefcase, ready: true, platformAdmin: true, needsOrg: false },
      { label: "Infrastructure Health", href: "/platform/health", icon: Stethoscope, ready: true, platformAdmin: true, needsOrg: false },
      { label: "System Events", href: "/platform/events", icon: Server, ready: true, platformAdmin: true, needsOrg: false },
      { label: "Deployment Versions", href: "/platform/versions", icon: Cpu, ready: true, platformAdmin: true, needsOrg: false },
      { label: "Operational Diagnostics", href: "/platform/diagnostics", icon: Database, ready: true, platformAdmin: true, needsOrg: false },
    ],
  },
];

/** Every group, primary first, for consumers that want the flat structure (search, sitemaps). */
export const NAV: NavGroup[] = [{ label: "Primary", items: [GETTING_STARTED, ...PRIMARY_NAV] }, ...SECONDARY_NAV];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

function matches(pathname: string, href: string): boolean {
  if (href === "/overview") return pathname === "/overview";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Active when the path is under this item and no more specific item (for example /integrations/marketplace under /integrations) matches it. */
export function isActivePath(pathname: string, href: string): boolean {
  if (!matches(pathname, href)) return false;
  return !ALL_NAV_ITEMS.some((i) => i.href.length > href.length && i.href.startsWith(href + "/") && matches(pathname, i.href));
}

/** True when the current path belongs to one of the secondary groups (so "More" opens on its own). */
export function isSecondaryPath(pathname: string): boolean {
  return SECONDARY_NAV.some((g) => g.items.some((i) => isActivePath(pathname, i.href)));
}

