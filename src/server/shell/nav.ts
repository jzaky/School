import type { Ctx } from "@/server/context";
import { isPlatformAdmin } from "@/server/platform/catalog-db";

export type NavItem = { key: string; href: string; icon: string; badge?: number };
export type NavSection = { key: string; items: NavItem[] };

/** Role-aware navigation. Only features the member can use appear. */
export function buildNav(ctx: Ctx, counts: { approvals: number; tasks: number; notifications: number; joinRequests?: number; group?: boolean }): NavSection[] {
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
          { key: "timetable", href: "/timetable", icon: "calendar-days" },
          { key: "career", href: "/career", icon: "compass" },
          { key: "careerEvents", href: "/career/events", icon: "calendar-check" },
          { key: "partnerResources", href: "/career/resources", icon: "handshake" },
          ...(c("registration.submit") ? [{ key: "subjects", href: "/subjects", icon: "book-open" }] : []),
          ...(c("grades.view_own") ? [{ key: "grades", href: "/grades", icon: "clipboard-check" }] : []),
          ...(c("pathways.view") ? [{ key: "pathwayPlanning", href: "/career/pathways", icon: "map" }, { key: "universities", href: "/career/universities", icon: "landmark" }] : []),
          ...(c("pathways.view") ? [{ key: "applications", href: "/career/applications", icon: "send" }] : []),
          { key: "calendar", href: "/calendar", icon: "calendar" },
          { key: "exams", href: "/exams", icon: "graduation-cap" },
          { key: "trips", href: "/trips", icon: "bus" },
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
          ...(c("registration.submit") ? [{ key: "subjects", href: "/subjects", icon: "book-open" }] : []),
          ...(c("grades.view_own") ? [{ key: "grades", href: "/grades", icon: "clipboard-check" }] : []),
          ...(c("pathways.view") ? [{ key: "pathwayPlanning", href: "/career/pathways", icon: "map" }, { key: "universities", href: "/career/universities", icon: "landmark" }] : []),
          ...(c("pathways.view") ? [{ key: "applications", href: "/career/applications", icon: "send" }] : []),
          { key: "careerEvents", href: "/career/events", icon: "calendar-check" },
          { key: "partnerResources", href: "/career/resources", icon: "handshake" },
          { key: "services", href: "/services", icon: "layout-grid" },
          { key: "requests", href: "/requests", icon: "inbox" },
          { key: "approvals", href: "/approvals", icon: "stamp", badge: counts.approvals },
          { key: "meetings", href: "/meetings", icon: "calendar-clock" },
          { key: "timetable", href: "/timetable", icon: "calendar-days" },
          { key: "calendar", href: "/calendar", icon: "calendar" },
          { key: "exams", href: "/exams", icon: "graduation-cap" },
          { key: "trips", href: "/trips", icon: "bus" },
          { key: "documents", href: "/documents", icon: "file-text" },
          // The school's own payment portal; hidden until the school sets a link.
          ...(ctx.org.feePaymentUrl ? [{ key: "fees", href: "/fees", icon: "credit-card" }] : []),
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
    { key: "timetable", href: "/timetable", icon: "calendar-days" },
  ];
  if (c("cases.view")) work.splice(3, 0, { key: "cases", href: "/cases", icon: "folder-kanban" });
  work.push({ key: "exams", href: "/exams", icon: "graduation-cap" });
  if (c("trips.manage")) work.push({ key: "trips", href: "/trips", icon: "bus" });
  const school: NavItem[] = [];
  if (c("people.view")) school.push({ key: "students", href: "/students", icon: "graduation-cap" });
  if (c("grades.enter") || c("registration.manage")) school.push({ key: "classes", href: "/classes", icon: "school" });
  if (c("grades.enter") || c("grades.view_all")) school.push({ key: "grades", href: "/grades", icon: "clipboard-check" });
  if (c("career.advise")) school.push({ key: "career", href: "/career", icon: "compass" }, { key: "careerEvents", href: "/career/events", icon: "calendar-check" });
  if (c("career.partners") || c("career.advise")) school.push({ key: "partnerResources", href: "/career/resources", icon: "handshake" });
  if (c("pathways.view") && c("people.view")) school.push({ key: "pathwayPlanning", href: "/career/pathways", icon: "map" });
  if (c("pathways.view") && c("people.view") && (c("planner.approve") || c("pathways.manage"))) school.push({ key: "pathwayDashboard", href: "/career/pathways/dashboard", icon: "list-checks" });
  if (c("pathways.view")) school.push({ key: "universities", href: "/career/universities", icon: "landmark" });
  if (c("applications.manage")) school.push({ key: "applications", href: "/career/applications/manage", icon: "send" });
  if (c("catalog.review")) school.push({ key: "catalogReview", href: "/career/catalog", icon: "clipboard-check" });
  if (c("safeguarding.view") || c("safeguarding.refer")) school.push({ key: "safeguarding", href: "/safeguarding", icon: "shield" });
  school.push({ key: "documents", href: "/documents", icon: "file-text" });
  if (c("curriculum.plan") || c("curriculum.review") || c("curriculum.manage")) school.push({ key: "curriculum", href: "/curriculum", icon: "book-open" });
  if (c("analytics.view")) school.push({ key: "analytics", href: "/analytics", icon: "bar-chart-3" });
  // School group people (see src/server/groups): a way into the group area.
  if (counts.group) school.push({ key: "groupDashboard", href: "/group", icon: "network" });
  const admin: NavItem[] = [];
  if (c("school.manage") || ctx.roles.includes("principal")) admin.push({ key: "setup", href: "/setup", icon: "list-checks" });
  if (c("school.manage")) admin.push({ key: "schoolSetup", href: "/admin/school", icon: "building-2" });
  if (c("people.manage")) admin.push({ key: "people", href: "/admin/people", icon: "contact" });
  if (c("admin.access") && c("people.manage")) admin.push({ key: "import", href: "/admin/import", icon: "file-spreadsheet" });
  if (c("integrations.manage")) admin.push({ key: "integrations", href: "/admin/integrations", icon: "plug" });
  if (c("roles.manage")) admin.push({ key: "roles", href: "/admin/roles", icon: "lock" });
  if (c("people.invite")) admin.push({ key: "invitations", href: "/admin/invitations", icon: "mail" });
  if (c("people.manage") || c("people.invite")) admin.push({ key: "joinRequests", href: "/admin/join-requests", icon: "users", badge: counts.joinRequests });
  if (c("registration.manage")) admin.push({ key: "registration", href: "/admin/registration", icon: "clipboard-check" });
  if (c("timetable.manage")) admin.push({ key: "timetableAdmin", href: "/admin/timetable", icon: "clock" });
  if (c("cover.manage")) admin.push({ key: "cover", href: "/admin/cover", icon: "calendar-x" });
  if (c("services.manage")) admin.push({ key: "servicesAdmin", href: "/admin/services", icon: "blocks" });
  if (c("forms.manage")) admin.push({ key: "forms", href: "/admin/forms", icon: "list-checks" });
  if (c("workflows.manage")) admin.push({ key: "workflows", href: "/admin/workflows", icon: "workflow" });
  if (c("documents.templates")) admin.push({ key: "templates", href: "/admin/templates", icon: "file-signature" });
  if (c("calendar.manage")) admin.push({ key: "calendarAdmin", href: "/admin/calendar", icon: "calendar-days" }, { key: "examsAdmin", href: "/admin/exams", icon: "clipboard-check" });
  if (c("compliance.manage")) admin.push({ key: "compliance", href: "/admin/compliance", icon: "scale" });
  if (c("audit.view")) admin.push({ key: "auditLog", href: "/admin/audit", icon: "scroll-text" });
  if (c("inspection.view")) admin.push({ key: "inspection", href: "/admin/inspection", icon: "clipboard-list" });
  if (c("school.manage") || ctx.roles.includes("principal")) admin.push({ key: "referral", href: "/admin/referral", icon: "gift" });
  const sections: NavSection[] = [
    { key: "sectionWork", items: work },
    { key: "sectionSchool", items: school },
  ];
  if (admin.length) sections.push({ key: "sectionAdmin", items: admin });
  // Platform admins (PLATFORM_ADMIN_EMAILS): marketing leads, referrals across schools, platform settings.
  if (isPlatformAdmin(ctx.user)) {
    sections.push({
      key: "sectionPlatform",
      items: [
        { key: "platformSchools", href: "/platform/schools", icon: "building-2" },
        { key: "platformLeads", href: "/platform/leads", icon: "inbox" },
        { key: "platformReferrals", href: "/platform/referrals", icon: "share-2" },
        { key: "platformSettings", href: "/platform/settings", icon: "settings" },
      ],
    });
  }
  return sections;
}
