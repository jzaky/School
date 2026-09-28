import type { Ctx } from "@/server/context";

export type NavItem = { key: string; href: string; icon: string; badge?: number };
export type NavSection = { key: string; items: NavItem[] };

/** Role-aware navigation. Only features the member can use appear. */
export function buildNav(ctx: Ctx, counts: { approvals: number; tasks: number; notifications: number }): NavSection[] {
  const c = ctx.can;
  if (ctx.isStudent) {
    return [
      {
        key: "sectionMe",
        items: [
          { key: "home", href: "/home", icon: "home" },
          { key: "services", href: "/services", icon: "layout-grid" },
          { key: "myRequests", href: "/requests", icon: "inbox" },
          { key: "meetings", href: "/meetings", icon: "calendar-clock" },
          { key: "tasks", href: "/tasks", icon: "check-square", badge: counts.tasks },
          { key: "career", href: "/career", icon: "compass" },
          { key: "calendar", href: "/calendar", icon: "calendar" },
          { key: "documents", href: "/documents", icon: "file-text" },
        ],
      },
    ];
  }
  if (ctx.isParent) {
    return [
      {
        key: "sectionMe",
        items: [
          { key: "home", href: "/home", icon: "home" },
          { key: "children", href: "/children", icon: "users" },
          { key: "services", href: "/services", icon: "layout-grid" },
          { key: "requests", href: "/requests", icon: "inbox" },
          { key: "approvals", href: "/approvals", icon: "stamp", badge: counts.approvals },
          { key: "meetings", href: "/meetings", icon: "calendar-clock" },
          { key: "calendar", href: "/calendar", icon: "calendar" },
          { key: "documents", href: "/documents", icon: "file-text" },
        ],
      },
    ];
  }
  const work: NavItem[] = [
    { key: "home", href: "/home", icon: "home" },
    { key: "services", href: "/services", icon: "layout-grid" },
    { key: "requests", href: "/requests", icon: "inbox" },
    { key: "approvals", href: "/approvals", icon: "stamp", badge: counts.approvals },
    { key: "tasks", href: "/tasks", icon: "check-square", badge: counts.tasks },
    { key: "calendar", href: "/calendar", icon: "calendar" },
  ];
  if (c("cases.view")) work.splice(3, 0, { key: "cases", href: "/cases", icon: "folder-kanban" });
  const school: NavItem[] = [];
  if (c("people.view")) school.push({ key: "students", href: "/students", icon: "graduation-cap" });
  if (c("career.advise")) school.push({ key: "career", href: "/career", icon: "compass" });
  if (c("safeguarding.view") || c("safeguarding.refer")) school.push({ key: "safeguarding", href: "/safeguarding", icon: "shield" });
  school.push({ key: "documents", href: "/documents", icon: "file-text" });
  if (c("analytics.view")) school.push({ key: "analytics", href: "/analytics", icon: "bar-chart-3" });
  const admin: NavItem[] = [];
  if (c("school.manage")) admin.push({ key: "schoolSetup", href: "/admin/school", icon: "building-2" });
  if (c("people.manage")) admin.push({ key: "people", href: "/admin/people", icon: "contact" });
  if (c("services.manage")) admin.push({ key: "servicesAdmin", href: "/admin/services", icon: "blocks" });
  if (c("forms.manage")) admin.push({ key: "forms", href: "/admin/forms", icon: "list-checks" });
  if (c("workflows.manage")) admin.push({ key: "workflows", href: "/admin/workflows", icon: "workflow" });
  if (c("documents.templates")) admin.push({ key: "templates", href: "/admin/templates", icon: "file-signature" });
  if (c("compliance.manage")) admin.push({ key: "compliance", href: "/admin/compliance", icon: "scale" });
  if (c("audit.view")) admin.push({ key: "auditLog", href: "/admin/audit", icon: "scroll-text" });
  const sections: NavSection[] = [
    { key: "sectionWork", items: work },
    { key: "sectionSchool", items: school },
  ];
  if (admin.length) sections.push({ key: "sectionAdmin", items: admin });
  return sections;
}
