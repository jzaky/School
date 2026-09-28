// Starting configuration for steps added in the workflow builder. Bilingual data, stored in the graph. Pure module.
import type { Assignee, NodeConfig, NodeType } from "./graph";

export type DefaultsContext = {
  safeguarding: boolean;
  appointmentTypeKey?: string | null;
  documentTemplateKey?: string | null;
};

export const EDGE_LABELS: Record<string, { en: string; ar: string }> = {
  approved: { en: "Approved", ar: "تمت الموافقة" },
  rejected: { en: "Rejected", ar: "مرفوض" },
  true: { en: "Yes", ar: "نعم" },
  false: { en: "No", ar: "لا" },
};

export function defaultNodeConfig(type: NodeType, c: DefaultsContext): NodeConfig {
  const owner: Assignee = c.safeguarding ? { kind: "role", role: "dsl" } : { kind: "role", role: "school_admin" };
  switch (type) {
    case "start":
      return { label: { en: "Request submitted", ar: "تم تقديم الطلب" } };
    case "approval":
      return {
        label: { en: "Approval", ar: "موافقة" },
        mode: "PARALLEL_ANY",
        approvers: [
          c.safeguarding
            ? { assignee: { kind: "role", role: "dsl" }, label: { en: "Designated Safeguarding Lead", ar: "مسؤول حماية الطفل" } }
            : { assignee: { kind: "role", role: "principal" }, label: { en: "Principal", ar: "مدير المدرسة" } },
        ],
        dueInHours: 48,
      };
    case "task":
      return {
        label: { en: "Task", ar: "مهمة" },
        assignee: c.safeguarding ? { kind: "case_assignee" } : owner,
        title: { en: "Complete this step", ar: "إنجاز هذه الخطوة" },
        dueInHours: 48,
        blocking: false,
      };
    case "notify":
      return c.safeguarding
        ? {
            label: { en: "Notify the safeguarding team", ar: "إشعار فريق حماية الطفل" },
            recipients: [{ kind: "role", role: "dsl" }],
            template: "safeguarding_new",
            channels: ["IN_APP", "EMAIL"],
          }
        : {
            label: { en: "Notify the requester", ar: "إبلاغ مقدم الطلب" },
            recipients: [{ kind: "requester" }],
            template: "request_completed",
            channels: ["IN_APP", "EMAIL"],
          };
    case "condition":
      return { label: { en: "Is it about a student?", ar: "هل يخص طالبًا؟" }, condition: { field: "request.hasStudent", op: "eq", value: true } };
    case "wait":
      return { label: { en: "Wait", ar: "انتظار" }, hours: 24 };
    case "create_case":
      return c.safeguarding
        ? { label: { en: "Open restricted safeguarding case", ar: "فتح ملف حماية مقيّد" }, caseType: "SAFEGUARDING", sensitivity: "SAFEGUARDING", priority: "HIGH", assignee: { kind: "role", role: "dsl" } }
        : { label: { en: "Open a case", ar: "فتح حالة" }, caseType: "OTHER", sensitivity: "STANDARD", priority: "MEDIUM", assignee: { kind: "role", role: "counselor" } };
    case "assign":
      return { label: { en: "Assign an owner", ar: "تعيين مسؤول" }, assignee: c.safeguarding ? { kind: "role", role: "dsl" } : { kind: "role", role: "counselor" } };
    case "schedule_meeting":
      return {
        label: { en: "Book a meeting", ar: "حجز اجتماع" },
        appointmentTypeKey: c.appointmentTypeKey ?? undefined,
        assignee: c.safeguarding ? { kind: "case_assignee" } : owner,
        title: { en: "Book a meeting with the family", ar: "حجز اجتماع مع الأسرة" },
        dueInHours: 72,
      };
    case "generate_document":
      return { label: { en: "Generate a document", ar: "إنشاء مستند" }, templateKey: c.documentTemplateKey ?? undefined, output: "BILINGUAL" };
    case "update_status":
      return { label: { en: "In progress", ar: "قيد التنفيذ" }, status: "IN_PROGRESS", progress: 50 };
    case "ai_summary":
      return { label: { en: "Prepare a brief", ar: "إعداد ملخص" } };
    case "end":
      return { label: { en: "Completed", ar: "مكتمل" }, outcome: "COMPLETED" };
  }
}
