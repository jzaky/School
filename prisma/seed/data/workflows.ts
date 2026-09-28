// Seeded workflow templates. Each graph is executed by src/server/workflows/engine.ts.
import type {
  NodeConfig,
  NodeType,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowTemplate,
} from "@/server/workflows/graph";

type NodeSpec = [id: string, type: NodeType, data: NodeConfig, col?: number];
type EdgeSpec = [source: string, target: string, handle?: string];

const X_GAP = 300;
const Y_GAP = 130;

/** Lay nodes out top to bottom. `col` shifts a node sideways for branches. */
function graph(nodes: NodeSpec[], edges: EdgeSpec[]): WorkflowGraph {
  const rows = new Map<number, number>();
  const outNodes: WorkflowNode[] = nodes.map(([id, type, data, col = 0], i) => {
    const row = i;
    rows.set(col, row);
    return { id, type, data, position: { x: 80 + col * X_GAP, y: 40 + row * Y_GAP } };
  });
  const handleLabels: Record<string, { en: string; ar: string }> = {
    approved: { en: "Approved", ar: "تمت الموافقة" },
    rejected: { en: "Rejected", ar: "مرفوض" },
    true: { en: "Yes", ar: "نعم" },
    false: { en: "No", ar: "لا" },
  };
  const outEdges: WorkflowEdge[] = edges.map(([source, target, handle], i) => ({
    id: `e${i + 1}`,
    source,
    target,
    sourceHandle: handle ?? null,
    label: handle ? handleLabels[handle] : undefined,
  }));
  return { nodes: outNodes, edges: outEdges };
}

const start = (en = "Request submitted", ar = "تم تقديم الطلب"): NodeSpec => ["start", "start", { label: { en, ar } }];
const endOk = (id = "end", en = "Completed", ar = "مكتمل"): NodeSpec => [id, "end", { label: { en, ar }, outcome: "COMPLETED" }];
const endRejected = (id = "end_rejected", col = 1): NodeSpec => [
  id,
  "end",
  { label: { en: "Closed as not approved", ar: "أُغلق دون موافقة" }, outcome: "REJECTED" },
  col,
];

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "academic_concern",
    name: { en: "Academic Concern Referral", ar: "إحالة لمخاوف أكاديمية" },
    description: {
      en: "A teacher refers a student. A case opens for the grade counselor, the family is invited to a meeting and a follow-up review is scheduled.",
      ar: "يحيل المعلم الطالب، فتُفتح حالة لدى المرشد المسؤول عن الصف، وتُدعى الأسرة إلى اجتماع، ثم تُجدول مراجعة للمتابعة.",
    },
    graph: graph(
      [
        start("Referral submitted", "تم تقديم الإحالة"),
        [
          "case",
          "create_case",
          {
            label: { en: "Open academic support case", ar: "فتح حالة دعم أكاديمي" },
            caseType: "ACADEMIC",
            sensitivity: "STANDARD",
            priority: "form:urgency",
            assignee: { kind: "role", role: "counselor" },
          },
        ],
        [
          "notify_counselor",
          "notify",
          {
            label: { en: "Notify the counselor", ar: "إشعار المرشد" },
            recipients: [{ kind: "case_assignee" }],
            template: "case_assigned",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        [
          "status_review",
          "update_status",
          {
            label: { en: "Counselor reviewing", ar: "قيد مراجعة المرشد" },
            status: "IN_PROGRESS",
            progress: 40,
          },
        ],
        [
          "meeting",
          "schedule_meeting",
          {
            label: { en: "Book a parent meeting", ar: "حجز اجتماع مع ولي الأمر" },
            appointmentTypeKey: "counselor_meeting",
            assignee: { kind: "case_assignee" },
            title: { en: "Book a meeting with the family", ar: "حجز اجتماع مع الأسرة" },
            dueInHours: 72,
          },
        ],
        [
          "plan_task",
          "task",
          {
            label: { en: "Agree an action plan", ar: "الاتفاق على خطة عمل" },
            assignee: { kind: "case_assignee" },
            title: { en: "Draft and share the action plan", ar: "إعداد خطة العمل ومشاركتها" },
            dueInHours: 120,
            blocking: true,
          },
        ],
        [
          "referrer_update",
          "notify",
          {
            label: { en: "Update the referring teacher", ar: "إبلاغ المعلم المُحيل" },
            recipients: [{ kind: "requester" }],
            template: "referral_accepted",
            channels: ["IN_APP"],
          },
        ],
        ["wait_followup", "wait", { label: { en: "Wait two weeks", ar: "انتظار أسبوعين" }, hours: 336 }],
        [
          "followup",
          "task",
          {
            label: { en: "Follow-up review", ar: "مراجعة المتابعة" },
            assignee: { kind: "case_assignee" },
            title: { en: "Two-week follow-up review", ar: "مراجعة المتابعة بعد أسبوعين" },
            dueInHours: 48,
          },
        ],
        endOk("end", "Referral handled", "تمت معالجة الإحالة"),
      ],
      [
        ["start", "case"],
        ["case", "notify_counselor"],
        ["notify_counselor", "status_review"],
        ["status_review", "meeting"],
        ["meeting", "plan_task"],
        ["plan_task", "referrer_update"],
        ["referrer_update", "wait_followup"],
        ["wait_followup", "followup"],
        ["followup", "end"],
      ],
    ),
  },
  {
    key: "behavioral_referral",
    name: { en: "Behavioral Referral", ar: "إحالة سلوكية" },
    description: {
      en: "Records a behavior incident, opens a case and escalates serious incidents to the principal.",
      ar: "يوثّق الحادثة السلوكية ويفتح حالة ويصعّد الحوادث الجسيمة إلى مدير المدرسة.",
    },
    graph: graph(
      [
        start("Referral submitted", "تم تقديم الإحالة"),
        [
          "case",
          "create_case",
          {
            label: { en: "Open behavior case", ar: "فتح حالة سلوكية" },
            caseType: "BEHAVIOR",
            sensitivity: "STANDARD",
            priority: "form:urgency",
            assignee: { kind: "role", role: "counselor" },
          },
        ],
        [
          "serious",
          "condition",
          {
            label: { en: "Is it serious?", ar: "هل الحادثة جسيمة؟" },
            condition: { field: "form.urgency", op: "eq", value: "high" },
          },
        ],
        [
          "notify_principal",
          "notify",
          {
            label: { en: "Alert the principal", ar: "تنبيه مدير المدرسة" },
            recipients: [{ kind: "role", role: "principal" }],
            template: "case_escalated",
            channels: ["IN_APP", "EMAIL"],
          },
          1,
        ],
        [
          "notify_counselor",
          "notify",
          {
            label: { en: "Notify the counselor", ar: "إشعار المرشد" },
            recipients: [{ kind: "case_assignee" }],
            template: "case_assigned",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        [
          "task",
          "task",
          {
            label: { en: "Restorative conversation", ar: "حوار تصالحي" },
            assignee: { kind: "case_assignee" },
            title: { en: "Hold a restorative conversation", ar: "عقد حوار تصالحي مع الطالب" },
            dueInHours: 72,
          },
        ],
        endOk("end", "Referral handled", "تمت معالجة الإحالة"),
      ],
      [
        ["start", "case"],
        ["case", "serious"],
        ["serious", "notify_principal", "true"],
        ["serious", "notify_counselor", "false"],
        ["notify_principal", "notify_counselor"],
        ["notify_counselor", "task"],
        ["task", "end"],
      ],
    ),
  },
  {
    key: "career_guidance",
    name: { en: "Career Guidance", ar: "التوجيه المهني" },
    description: {
      en: "A student asks for career guidance. The career advisor receives the full context and a session is booked.",
      ar: "يطلب الطالب التوجيه المهني، فتصل إلى المستشار الصورة الكاملة ويُحجز له موعد.",
    },
    graph: graph(
      [
        start(),
        [
          "case",
          "create_case",
          {
            label: { en: "Open career guidance case", ar: "فتح ملف توجيه مهني" },
            caseType: "CAREER",
            sensitivity: "STANDARD",
            priority: "MEDIUM",
            assignee: { kind: "role", role: "career_advisor" },
          },
        ],
        [
          "notify_advisor",
          "notify",
          {
            label: { en: "Notify the career advisor", ar: "إشعار مستشار التوجيه" },
            recipients: [{ kind: "case_assignee" }],
            template: "case_assigned",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        [
          "status",
          "update_status",
          { label: { en: "Session booked", ar: "تم حجز الجلسة" }, status: "IN_PROGRESS", progress: 50 },
        ],
        [
          "summary",
          "ai_summary",
          {
            label: { en: "Prepare pre-meeting brief", ar: "إعداد ملخص ما قبل الجلسة" },
            assignee: { kind: "case_assignee" },
          },
        ],
        [
          "plan",
          "task",
          {
            label: { en: "Share action plan", ar: "مشاركة خطة العمل" },
            assignee: { kind: "case_assignee" },
            title: { en: "Share the career action plan with the student", ar: "مشاركة خطة العمل المهنية مع الطالب" },
            dueInHours: 96,
            blocking: true,
          },
        ],
        endOk("end", "Guidance delivered", "تم تقديم التوجيه"),
      ],
      [
        ["start", "case"],
        ["case", "notify_advisor"],
        ["notify_advisor", "status"],
        ["status", "summary"],
        ["summary", "plan"],
        ["plan", "end"],
      ],
    ),
  },
  {
    key: "subject_change",
    name: { en: "Subject Change", ar: "تغيير مادة دراسية" },
    description: {
      en: "Parent consent, then the current teacher and the receiving head of department, then the registrar updates the timetable.",
      ar: "موافقة ولي الأمر، ثم المعلم الحالي ورئيس القسم المستقبِل، ثم يحدّث المسجل الجدول الدراسي.",
    },
    graph: graph(
      [
        start(),
        [
          "parent",
          "approval",
          {
            label: { en: "Parent consent", ar: "موافقة ولي الأمر" },
            mode: "PARALLEL_ANY",
            approvers: [
              {
                assignee: { kind: "guardians" },
                label: { en: "Parent or guardian", ar: "ولي الأمر" },
                requireSignature: true,
              },
            ],
            dueInHours: 72,
          },
        ],
        [
          "academic",
          "approval",
          {
            label: { en: "Teacher and head of department", ar: "المعلم ورئيس القسم" },
            mode: "SEQUENTIAL",
            approvers: [
              {
                assignee: { kind: "class_teacher", subjectField: "fromSubject" },
                label: { en: "Current subject teacher", ar: "معلم المادة الحالية" },
              },
              {
                assignee: { kind: "department_head", subjectField: "toSubject" },
                label: { en: "Head of receiving department", ar: "رئيس القسم المستقبِل" },
              },
            ],
            dueInHours: 96,
          },
        ],
        [
          "registrar",
          "approval",
          {
            label: { en: "Registrar confirms timetable", ar: "اعتماد المسجل للجدول" },
            mode: "PARALLEL_ANY",
            approvers: [
              { assignee: { kind: "role", role: "registrar" }, label: { en: "Registrar", ar: "المسجل" } },
            ],
            dueInHours: 48,
          },
        ],
        [
          "status",
          "update_status",
          { label: { en: "Timetable updated", ar: "تم تحديث الجدول" }, status: "COMPLETED", progress: 100 },
        ],
        [
          "notify",
          "notify",
          {
            label: { en: "Tell the student and family", ar: "إبلاغ الطالب والأسرة" },
            recipients: [{ kind: "student" }, { kind: "guardians" }, { kind: "requester" }],
            template: "subject_change_done",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        endOk("end", "Subject changed", "تم تغيير المادة"),
        endRejected("end_rejected", 1),
      ],
      [
        ["start", "parent"],
        ["parent", "academic", "approved"],
        ["parent", "end_rejected", "rejected"],
        ["academic", "registrar", "approved"],
        ["academic", "end_rejected", "rejected"],
        ["registrar", "status", "approved"],
        ["registrar", "end_rejected", "rejected"],
        ["status", "notify"],
        ["notify", "end"],
      ],
    ),
  },
  {
    key: "document_request",
    name: { en: "Document Request", ar: "طلب مستند" },
    description: {
      en: "The registrar approves, the letter is generated in the chosen language and the requester is notified.",
      ar: "يعتمد المسجل الطلب، فيُنشأ الخطاب باللغة المختارة ويُبلَّغ مقدم الطلب.",
    },
    graph: graph(
      [
        start(),
        [
          "registrar",
          "approval",
          {
            label: { en: "Registrar review", ar: "مراجعة المسجل" },
            mode: "PARALLEL_ANY",
            approvers: [
              { assignee: { kind: "role", role: "registrar" }, label: { en: "Registrar", ar: "المسجل" } },
            ],
            dueInHours: 48,
          },
        ],
        [
          "generate",
          "generate_document",
          {
            label: { en: "Generate the letter", ar: "إنشاء الخطاب" },
            templateKey: "form:documentType",
            output: "BILINGUAL",
          },
        ],
        [
          "notify",
          "notify",
          {
            label: { en: "Document ready", ar: "المستند جاهز" },
            recipients: [{ kind: "requester" }, { kind: "student" }],
            template: "document_ready",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        endOk("end", "Document issued", "تم إصدار المستند"),
        endRejected("end_rejected", 1),
      ],
      [
        ["start", "registrar"],
        ["registrar", "generate", "approved"],
        ["registrar", "end_rejected", "rejected"],
        ["generate", "notify"],
        ["notify", "end"],
      ],
    ),
  },
  {
    key: "parent_meeting",
    name: { en: "Parent Meeting", ar: "اجتماع ولي الأمر" },
    description: {
      en: "A meeting is booked on both calendars, the teacher is notified and reminders go out automatically.",
      ar: "يُحجز الاجتماع في تقويمي الطرفين ويُبلَّغ المعلم وتُرسل التذكيرات تلقائيًا.",
    },
    graph: graph(
      [
        start("Meeting requested", "تم طلب الاجتماع"),
        [
          "notify_host",
          "notify",
          {
            label: { en: "Notify the teacher", ar: "إشعار المعلم" },
            recipients: [{ kind: "role", role: "appointment_host" }],
            template: "meeting_booked",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        [
          "prep",
          "task",
          {
            label: { en: "Prepare for the meeting", ar: "التحضير للاجتماع" },
            assignee: { kind: "role", role: "appointment_host" },
            title: { en: "Prepare notes for the parent meeting", ar: "إعداد ملاحظات اجتماع ولي الأمر" },
            dueInHours: 24,
          },
        ],
        [
          "status",
          "update_status",
          { label: { en: "Meeting confirmed", ar: "تم تأكيد الاجتماع" }, status: "COMPLETED", progress: 100 },
        ],
        endOk("end", "Meeting booked", "تم حجز الاجتماع"),
      ],
      [
        ["start", "notify_host"],
        ["notify_host", "prep"],
        ["prep", "status"],
        ["status", "end"],
      ],
    ),
  },
  {
    key: "it_support",
    name: { en: "IT Support", ar: "الدعم التقني" },
    description: {
      en: "Routes the ticket to IT support and closes the request when the task is done.",
      ar: "يحوّل البلاغ إلى الدعم التقني ويُغلق الطلب عند إنجاز المهمة.",
    },
    graph: graph(
      [
        start(),
        [
          "task",
          "task",
          {
            label: { en: "Resolve the issue", ar: "حل المشكلة" },
            assignee: { kind: "role", role: "it_support" },
            title: { en: "Resolve IT ticket", ar: "معالجة بلاغ الدعم التقني" },
            dueInHours: 24,
            blocking: true,
          },
        ],
        [
          "notify",
          "notify",
          {
            label: { en: "Tell the requester", ar: "إبلاغ مقدم الطلب" },
            recipients: [{ kind: "requester" }],
            template: "request_completed",
            channels: ["IN_APP"],
          },
        ],
        endOk("end", "Resolved", "تم الحل"),
      ],
      [
        ["start", "task"],
        ["task", "notify"],
        ["notify", "end"],
      ],
    ),
  },
  {
    key: "learning_support",
    name: { en: "Learning Support", ar: "دعم التعلم" },
    description: {
      en: "Opens a learning support case, asks the family for consent to assess, then books a review meeting.",
      ar: "يفتح حالة دعم تعلم ويطلب موافقة الأسرة على التقييم ثم يحجز اجتماع مراجعة.",
    },
    graph: graph(
      [
        start(),
        [
          "case",
          "create_case",
          {
            label: { en: "Open learning support case", ar: "فتح حالة دعم تعلم" },
            caseType: "LEARNING_SUPPORT",
            sensitivity: "CONFIDENTIAL",
            priority: "MEDIUM",
            assignee: { kind: "role", role: "counselor" },
          },
        ],
        [
          "consent",
          "approval",
          {
            label: { en: "Parent consent to assess", ar: "موافقة ولي الأمر على التقييم" },
            mode: "PARALLEL_ANY",
            approvers: [
              {
                assignee: { kind: "guardians" },
                label: { en: "Parent or guardian", ar: "ولي الأمر" },
                requireSignature: true,
              },
            ],
            dueInHours: 120,
          },
        ],
        [
          "meeting",
          "schedule_meeting",
          {
            label: { en: "Book a review meeting", ar: "حجز اجتماع مراجعة" },
            appointmentTypeKey: "learning_support_review",
            assignee: { kind: "case_assignee" },
            title: { en: "Book the learning support review", ar: "حجز مراجعة دعم التعلم" },
            dueInHours: 96,
          },
        ],
        endOk("end", "Support in place", "الدعم قيد التنفيذ"),
        endRejected("end_rejected", 1),
      ],
      [
        ["start", "case"],
        ["case", "consent"],
        ["consent", "meeting", "approved"],
        ["consent", "end_rejected", "rejected"],
        ["meeting", "end"],
      ],
    ),
  },
  {
    key: "wellbeing_referral",
    name: { en: "Wellbeing Referral", ar: "إحالة للرفاه" },
    description: {
      en: "Confidential. Opens a wellbeing case for the counselor and wellbeing lead. Parents are only contacted by a recorded staff decision.",
      ar: "سري. يفتح حالة رفاه لدى المرشد ومسؤول الرفاه، ولا يُتواصل مع الأسرة إلا بقرار موثّق من الكادر.",
    },
    graph: graph(
      [
        start(),
        [
          "case",
          "create_case",
          {
            label: { en: "Open confidential wellbeing case", ar: "فتح حالة رفاه سرية" },
            caseType: "WELLBEING",
            sensitivity: "WELLBEING",
            priority: "HIGH",
            assignee: { kind: "role", role: "counselor" },
          },
        ],
        [
          "notify",
          "notify",
          {
            label: { en: "Notify wellbeing team", ar: "إشعار فريق الرفاه" },
            recipients: [{ kind: "case_assignee" }, { kind: "role", role: "wellbeing_lead" }],
            template: "wellbeing_referral",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        [
          "checkin",
          "task",
          {
            label: { en: "Check in with the student", ar: "التواصل مع الطالب" },
            assignee: { kind: "case_assignee" },
            title: { en: "Check in with the student today", ar: "التواصل مع الطالب اليوم" },
            dueInHours: 8,
          },
        ],
        endOk("end", "With the wellbeing team", "لدى فريق الرفاه"),
      ],
      [
        ["start", "case"],
        ["case", "notify"],
        ["notify", "checkin"],
        ["checkin", "end"],
      ],
    ),
  },
  {
    key: "safeguarding_concern",
    name: { en: "Safeguarding Concern", ar: "بلاغ حماية الطفل" },
    description: {
      en: "Restricted. Goes straight to the DSL and deputy. Immediate danger alerts them on every channel at once.",
      ar: "مقيّد. يصل مباشرة إلى مسؤول الحماية ونائبه، وفي حالات الخطر الفوري يُنبَّهان فورًا عبر جميع القنوات.",
    },
    graph: graph(
      [
        start("Concern raised", "تم رفع البلاغ"),
        [
          "case",
          "create_case",
          {
            label: { en: "Open restricted safeguarding case", ar: "فتح ملف حماية مقيّد" },
            caseType: "SAFEGUARDING",
            sensitivity: "SAFEGUARDING",
            priority: "form:level",
            assignee: { kind: "role", role: "dsl" },
          },
        ],
        [
          "danger",
          "condition",
          {
            label: { en: "Immediate danger?", ar: "خطر فوري؟" },
            condition: { field: "form.level", op: "eq", value: "IMMEDIATE_DANGER" },
          },
        ],
        [
          "alert_all",
          "notify",
          {
            label: { en: "Alert DSL and deputy on every channel", ar: "تنبيه مسؤول الحماية ونائبه عبر جميع القنوات" },
            recipients: [{ kind: "role", role: "dsl" }, { kind: "role", role: "deputy_dsl" }],
            template: "safeguarding_immediate",
            channels: ["IN_APP", "EMAIL", "SMS", "WHATSAPP"],
          },
          1,
        ],
        [
          "alert",
          "notify",
          {
            label: { en: "Notify DSL and deputy", ar: "إشعار مسؤول الحماية ونائبه" },
            recipients: [{ kind: "role", role: "dsl" }, { kind: "role", role: "deputy_dsl" }],
            template: "safeguarding_new",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        [
          "review",
          "task",
          {
            label: { en: "DSL review", ar: "مراجعة مسؤول الحماية" },
            assignee: { kind: "case_assignee" },
            title: { en: "Review the concern and decide next steps", ar: "مراجعة البلاغ وتحديد الخطوات التالية" },
            dueInHours: 24,
          },
        ],
        endOk("end", "Being handled", "قيد المعالجة"),
      ],
      [
        ["start", "case"],
        ["case", "danger"],
        ["danger", "alert_all", "true"],
        ["danger", "alert", "false"],
        ["alert_all", "review"],
        ["alert", "review"],
        ["review", "end"],
      ],
    ),
  },
  {
    key: "simple_approval",
    name: { en: "Single Approval", ar: "موافقة واحدة" },
    description: {
      en: "Student requests go to the homeroom teacher, staff requests go to the principal.",
      ar: "تذهب طلبات الطلاب إلى معلم الفصل، وطلبات الكادر إلى مدير المدرسة.",
    },
    graph: graph(
      [
        start(),
        [
          "has_student",
          "condition",
          {
            label: { en: "About a student?", ar: "يخص طالبًا؟" },
            condition: { field: "request.hasStudent", op: "eq", value: true },
          },
        ],
        [
          "homeroom",
          "approval",
          {
            label: { en: "Homeroom teacher", ar: "معلم الفصل" },
            mode: "PARALLEL_ANY",
            approvers: [{ assignee: { kind: "class_teacher" }, label: { en: "Homeroom teacher", ar: "معلم الفصل" } }],
            dueInHours: 48,
          },
        ],
        [
          "principal",
          "approval",
          {
            label: { en: "Principal", ar: "مدير المدرسة" },
            mode: "PARALLEL_ANY",
            approvers: [{ assignee: { kind: "role", role: "principal" }, label: { en: "Principal", ar: "مدير المدرسة" } }],
            dueInHours: 72,
          },
          1,
        ],
        [
          "notify",
          "notify",
          {
            label: { en: "Tell the requester", ar: "إبلاغ مقدم الطلب" },
            recipients: [{ kind: "requester" }],
            template: "request_completed",
            channels: ["IN_APP", "EMAIL"],
          },
        ],
        endOk("end", "Approved", "تمت الموافقة"),
        endRejected("end_rejected", 2),
      ],
      [
        ["start", "has_student"],
        ["has_student", "homeroom", "true"],
        ["has_student", "principal", "false"],
        ["homeroom", "notify", "approved"],
        ["homeroom", "end_rejected", "rejected"],
        ["principal", "notify", "approved"],
        ["principal", "end_rejected", "rejected"],
        ["notify", "end"],
      ],
    ),
  },
  {
    key: "simple_ticket",
    name: { en: "Service Ticket", ar: "تذكرة خدمة" },
    description: {
      en: "Routes the request to the school office and closes it when the task is done.",
      ar: "يحوّل الطلب إلى مكتب المدرسة ويُغلقه عند إنجاز المهمة.",
    },
    graph: graph(
      [
        start(),
        [
          "task",
          "task",
          {
            label: { en: "School office handles it", ar: "يتولى مكتب المدرسة المعالجة" },
            assignee: { kind: "role", role: "school_admin" },
            title: { en: "Handle service request", ar: "معالجة طلب الخدمة" },
            dueInHours: 48,
            blocking: true,
          },
        ],
        [
          "notify",
          "notify",
          {
            label: { en: "Tell the requester", ar: "إبلاغ مقدم الطلب" },
            recipients: [{ kind: "requester" }],
            template: "request_completed",
            channels: ["IN_APP"],
          },
        ],
        endOk("end", "Done", "تم"),
      ],
      [
        ["start", "task"],
        ["task", "notify"],
        ["notify", "end"],
      ],
    ),
  },
];
