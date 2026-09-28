// Deterministic workflow drafter used when no AI model is configured (or its answer is unusable).
// Reads keywords in English or Arabic and builds a linear approval workflow. Pure module.
import type { Assignee, WorkflowEdge, WorkflowGraph, WorkflowNode } from "./graph";
import { layoutGraph } from "./layout";

type I18nTextLike = { en: string; ar: string };

type Approver = { key: string; words: RegExp; assignee: Assignee; label: I18nTextLike };

const APPROVERS: Approver[] = [
  { key: "guardians", words: /\b(parent|parents|guardian|family|consent)\b|ولي الأمر|الأسرة|موافقة الأهل|أولياء/i, assignee: { kind: "guardians" }, label: { en: "Parent or guardian", ar: "ولي الأمر" } },
  { key: "class_teacher", words: /\b(teacher|homeroom|form tutor)\b|معلم|المعلم/i, assignee: { kind: "class_teacher" }, label: { en: "Homeroom teacher", ar: "معلم الفصل" } },
  { key: "department_head", words: /\b(head of department|hod|department head)\b|رئيس القسم/i, assignee: { kind: "role", role: "department_head" }, label: { en: "Head of department", ar: "رئيس القسم" } },
  { key: "counselor", words: /\b(counsell?or)\b|المرشد|مرشد/i, assignee: { kind: "role", role: "counselor" }, label: { en: "School counselor", ar: "المرشد الطلابي" } },
  { key: "nurse", words: /\b(nurse|clinic|medical)\b|الممرض|العيادة/i, assignee: { kind: "role", role: "nurse" }, label: { en: "School nurse", ar: "ممرض المدرسة" } },
  { key: "registrar", words: /\b(registrar|admissions|records)\b|المسجل|التسجيل/i, assignee: { kind: "role", role: "registrar" }, label: { en: "Registrar", ar: "المسجل" } },
  { key: "it_support", words: /\b(it support|it team|technology|laptop|device|wifi)\b|الدعم التقني/i, assignee: { kind: "role", role: "it_support" }, label: { en: "IT support", ar: "الدعم التقني" } },
  { key: "principal", words: /\b(principal|head ?teacher|director)\b|مدير المدرسة|المدير/i, assignee: { kind: "role", role: "principal" }, label: { en: "Principal", ar: "مدير المدرسة" } },
  { key: "school_admin", words: /\b(office|admin|administrator)\b|الإدارة|مكتب المدرسة/i, assignee: { kind: "role", role: "school_admin" }, label: { en: "School office", ar: "مكتب المدرسة" } },
];

export type DraftOptions = {
  /** Document template to use when the prompt mentions a letter or certificate. */
  documentTemplateKey?: string | null;
  /** Appointment type to use when the prompt mentions a meeting. */
  appointmentTypeKey?: string | null;
};

/** Build a sensible linear approval workflow from a free-text description. */
export function draftWorkflowFromText(prompt: string, opts: DraftOptions = {}): WorkflowGraph {
  const text = prompt.toLowerCase();
  const found = APPROVERS.map((a) => ({ a, at: text.search(a.words) })).filter((x) => x.at >= 0).sort((x, y) => x.at - y.at).map((x) => x.a);
  // IT and office are task owners, not approvers, unless nothing else was mentioned.
  const approvers = found.filter((a) => a.key !== "it_support" && a.key !== "school_admin");
  const owner = found.find((a) => a.key === "it_support" || a.key === "school_admin");
  if (!approvers.length && !owner) approvers.push(APPROVERS.find((a) => a.key === "principal")!);
  const wantsDoc = /\b(letter|certificate|document|transcript|report)\b|خطاب|شهادة|مستند|وثيقة/i.test(prompt) && Boolean(opts.documentTemplateKey);
  const wantsMeeting = /\b(meeting|meet|appointment)\b|اجتماع|موعد/i.test(prompt) && Boolean(opts.appointmentTypeKey);
  const urgent = /\b(urgent|same day|immediately|asap)\b|عاجل|فوري/i.test(prompt);

  const nodes: WorkflowNode[] = [{ id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: { en: "Request submitted", ar: "تم تقديم الطلب" } } }];
  const edges: WorkflowEdge[] = [];
  let prev = "start";
  let prevHandle: string | null = null;
  const link = (target: string) => {
    edges.push({ id: `e${edges.length + 1}`, source: prev, target, sourceHandle: prevHandle, ...(prevHandle ? { label: prevHandle === "approved" ? { en: "Approved", ar: "تمت الموافقة" } : { en: "Yes", ar: "نعم" } } : {}) });
    prev = target;
    prevHandle = null;
  };
  const needsReject = approvers.length > 0;

  approvers.forEach((a, i) => {
    const id = `approval_${i + 1}`;
    nodes.push({
      id,
      type: "approval",
      position: { x: 0, y: 0 },
      data: {
        label: { en: `${a.label.en} approval`, ar: `موافقة ${a.label.ar}` },
        mode: "PARALLEL_ANY",
        approvers: [{ assignee: a.assignee, label: a.label, ...(a.key === "guardians" ? { requireSignature: true } : {}) }],
        dueInHours: urgent ? 8 : 48,
      },
    });
    link(id);
    edges.push({ id: `e${edges.length + 1}`, source: id, target: "end_rejected", sourceHandle: "rejected", label: { en: "Rejected", ar: "مرفوض" } });
    prevHandle = "approved";
  });

  if (owner) {
    nodes.push({
      id: "task",
      type: "task",
      position: { x: 0, y: 0 },
      data: {
        label: { en: `${owner.label.en} handles it`, ar: `يتولى ${owner.label.ar} المعالجة` },
        assignee: owner.assignee,
        title: { en: "Handle the request", ar: "معالجة الطلب" },
        dueInHours: urgent ? 8 : 48,
        blocking: true,
      },
    });
    link("task");
  }
  if (wantsMeeting) {
    nodes.push({
      id: "meeting",
      type: "schedule_meeting",
      position: { x: 0, y: 0 },
      data: {
        label: { en: "Book a meeting", ar: "حجز اجتماع" },
        appointmentTypeKey: opts.appointmentTypeKey!,
        assignee: approvers[approvers.length - 1]?.assignee.kind === "role" ? approvers[approvers.length - 1].assignee : { kind: "role", role: "school_admin" },
        title: { en: "Book the meeting with the family", ar: "حجز الاجتماع مع الأسرة" },
        dueInHours: 72,
      },
    });
    link("meeting");
  }
  if (wantsDoc) {
    nodes.push({
      id: "document",
      type: "generate_document",
      position: { x: 0, y: 0 },
      data: { label: { en: "Generate the document", ar: "إنشاء المستند" }, templateKey: opts.documentTemplateKey!, output: "BILINGUAL" },
    });
    link("document");
  }
  nodes.push({ id: "status", type: "update_status", position: { x: 0, y: 0 }, data: { label: { en: "Request completed", ar: "اكتمل الطلب" }, status: "COMPLETED", progress: 100 } });
  link("status");
  nodes.push({
    id: "notify",
    type: "notify",
    position: { x: 0, y: 0 },
    data: {
      label: { en: "Tell the requester", ar: "إبلاغ مقدم الطلب" },
      recipients: [{ kind: "requester" }],
      template: wantsDoc ? "document_ready" : "request_completed",
      channels: ["IN_APP", "EMAIL"],
    },
  });
  link("notify");
  nodes.push({ id: "end", type: "end", position: { x: 0, y: 0 }, data: { label: { en: "Completed", ar: "مكتمل" }, outcome: "COMPLETED" } });
  link("end");
  if (needsReject) {
    nodes.push({ id: "end_rejected", type: "end", position: { x: 0, y: 0 }, data: { label: { en: "Closed as not approved", ar: "أُغلق دون موافقة" }, outcome: "REJECTED" } });
  }
  return layoutGraph({ nodes, edges });
}
