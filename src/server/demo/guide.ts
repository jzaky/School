// Suggested walkthrough steps per demo persona. Each step links to a real page.
export const GUIDE_STEPS: Record<string, Array<{ key: string; href: string }>> = {
  student: [
    { key: "assessment", href: "/career/assessment" },
    { key: "matches", href: "/career" },
    { key: "bookAdvisor", href: "/services/career_guidance" },
    { key: "myRequests", href: "/requests" },
    { key: "tasks", href: "/tasks" },
    { key: "examTimetable", href: "/exams" },
  ],
  parent: [
    { key: "children", href: "/children" },
    { key: "tripConsent", href: "/trips" },
    { key: "letter", href: "/services/document_request" },
    { key: "subjectChange", href: "/services/subject_change" },
    { key: "parentMeeting", href: "/services/parent_meeting" },
    { key: "documents", href: "/documents" },
  ],
  teacher: [
    { key: "refer", href: "/services/academic_concern" },
    { key: "approvals", href: "/approvals" },
    { key: "meetings", href: "/meetings" },
    { key: "safeguardingRefer", href: "/safeguarding" },
    { key: "tripBoard", href: "/trips" },
  ],
  counselor: [
    { key: "caseload", href: "/cases" },
    { key: "meetings", href: "/meetings" },
    { key: "calendar", href: "/calendar" },
    { key: "students", href: "/students" },
  ],
  career_advisor: [
    { key: "careerDesk", href: "/career" },
    { key: "caseload", href: "/cases" },
    { key: "calendar", href: "/calendar" },
  ],
  dsl: [
    { key: "sgQueue", href: "/safeguarding" },
    { key: "caseload", href: "/cases" },
    { key: "audit", href: "/admin/audit" },
  ],
  deputy_dsl: [{ key: "sgQueue", href: "/safeguarding" }],
  principal: [
    { key: "kpis", href: "/home" },
    { key: "analytics", href: "/analytics" },
    { key: "approvals", href: "/approvals" },
  ],
  admin: [
    { key: "servicesAdmin", href: "/admin/services" },
    { key: "formBuilder", href: "/admin/forms" },
    { key: "workflowBuilder", href: "/admin/workflows" },
    { key: "templates", href: "/admin/templates" },
    { key: "compliance", href: "/admin/compliance" },
    { key: "calendarAdmin", href: "/admin/calendar" },
    { key: "examsAdmin", href: "/admin/exams" },
  ],
  registrar: [
    { key: "approvals", href: "/approvals" },
    { key: "documents", href: "/documents" },
    { key: "templates", href: "/admin/templates" },
  ],
  hod_computing: [
    { key: "approvals", href: "/approvals" },
    { key: "requestsAll", href: "/requests?tab=all" },
  ],
};
