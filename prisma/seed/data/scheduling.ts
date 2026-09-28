// Appointment types, hosts and weekly availability for the demo school.
import type { I18nText } from "@/server/forms/schema";

export type AppointmentTypeSeed = {
  key: string;
  name: I18nText;
  description: I18nText;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  dailyMax: number | null;
  locationType: "IN_PERSON" | "ONLINE" | "PHONE";
  location: I18nText;
  hostMode: "SPECIFIC" | "ROUND_ROBIN";
  hostRoles: string[];
  audience: string[];
  color: string;
  intakeFormKey: string | null;
};

export const APPOINTMENT_TYPES: AppointmentTypeSeed[] = [
  {
    key: "career_guidance_session",
    name: { en: "Career guidance session", ar: "جلسة توجيه مهني" },
    description: {
      en: "A 45 minute one to one session to explore careers, subjects and universities.",
      ar: "جلسة فردية مدتها 45 دقيقة لاستكشاف المهن والمواد الدراسية والجامعات.",
    },
    durationMin: 45,
    bufferBeforeMin: 0,
    bufferAfterMin: 15,
    minNoticeMin: 12 * 60,
    dailyMax: 5,
    locationType: "IN_PERSON",
    location: { en: "Careers Hub, Block C, Room 204", ar: "مركز التوجيه المهني، المبنى C، الغرفة 204" },
    hostMode: "SPECIFIC",
    hostRoles: ["career_advisor"],
    audience: ["student", "parent"],
    color: "#7C3AED",
    intakeFormKey: "career_guidance",
  },
  {
    key: "counselor_meeting",
    name: { en: "Counselor meeting", ar: "لقاء مع المرشد الطلابي" },
    description: {
      en: "A confidential 30 minute conversation with your grade counselor.",
      ar: "حوار سري مدته 30 دقيقة مع المرشد الطلابي المسؤول عن صفك.",
    },
    durationMin: 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 10,
    minNoticeMin: 4 * 60,
    dailyMax: 8,
    locationType: "IN_PERSON",
    location: { en: "Student Services, Block A, Room 112", ar: "خدمات الطلاب، المبنى A، الغرفة 112" },
    hostMode: "ROUND_ROBIN",
    hostRoles: ["counselor"],
    audience: ["student", "parent", "staff"],
    color: "#0EA5E9",
    intakeFormKey: null,
  },
  {
    key: "parent_teacher_meeting",
    name: { en: "Parent-teacher meeting", ar: "اجتماع ولي الأمر مع المعلم" },
    description: {
      en: "A 20 minute meeting with one of your child's teachers, in person or online.",
      ar: "اجتماع مدته 20 دقيقة مع أحد معلمي ابنك أو ابنتك، حضوريًا أو عن بُعد.",
    },
    durationMin: 20,
    bufferBeforeMin: 0,
    bufferAfterMin: 10,
    minNoticeMin: 24 * 60,
    dailyMax: 6,
    locationType: "IN_PERSON",
    location: { en: "Meeting Room 1, Main Reception", ar: "قاعة الاجتماعات 1، الاستقبال الرئيسي" },
    hostMode: "SPECIFIC",
    hostRoles: ["teacher"],
    audience: ["parent", "staff"],
    color: "#10B981",
    intakeFormKey: "parent_meeting",
  },
  {
    key: "learning_support_review",
    name: { en: "Learning support review", ar: "مراجعة دعم التعلم" },
    description: {
      en: "A 40 minute review with the family, the counselor and the learning support team.",
      ar: "مراجعة مدتها 40 دقيقة مع الأسرة والمرشد وفريق دعم التعلم.",
    },
    durationMin: 40,
    bufferBeforeMin: 10,
    bufferAfterMin: 10,
    minNoticeMin: 48 * 60,
    dailyMax: 3,
    locationType: "IN_PERSON",
    location: { en: "Inclusion Centre, Block B", ar: "مركز الدمج، المبنى B" },
    hostMode: "ROUND_ROBIN",
    hostRoles: ["counselor"],
    audience: ["parent", "staff"],
    color: "#F59E0B",
    intakeFormKey: null,
  },
  {
    key: "wellbeing_checkin",
    name: { en: "Wellbeing check-in", ar: "لقاء اطمئنان" },
    description: {
      en: "A short, private check-in with the wellbeing team.",
      ar: "لقاء قصير وخاص مع فريق الرفاه للاطمئنان عليك.",
    },
    durationMin: 20,
    bufferBeforeMin: 0,
    bufferAfterMin: 10,
    minNoticeMin: 60,
    dailyMax: null,
    locationType: "IN_PERSON",
    location: { en: "Wellbeing Room, Block A", ar: "غرفة الرفاه، المبنى A" },
    hostMode: "ROUND_ROBIN",
    hostRoles: ["wellbeing_lead", "counselor"],
    audience: ["student"],
    color: "#EC4899",
    intakeFormKey: null,
  },
];

/** Default weekly availability in minutes after midnight, Asia/Dubai. Monday is 1, Friday is 5. */
export const DEFAULT_AVAILABILITY: Record<string, Array<[weekday: number, start: number, end: number]>> = {
  career_advisor: [
    [1, 8 * 60, 15 * 60],
    [2, 8 * 60, 15 * 60],
    [3, 8 * 60, 15 * 60],
    [4, 8 * 60, 15 * 60],
    [5, 8 * 60, 11 * 60 + 30],
  ],
  counselor: [
    [1, 7 * 60 + 45, 15 * 60],
    [2, 7 * 60 + 45, 15 * 60],
    [3, 7 * 60 + 45, 15 * 60],
    [4, 7 * 60 + 45, 15 * 60],
    [5, 7 * 60 + 45, 11 * 60 + 30],
  ],
  teacher: [
    [1, 14 * 60 + 30, 16 * 60 + 30],
    [2, 14 * 60 + 30, 16 * 60 + 30],
    [3, 7 * 60 + 15, 8 * 60],
    [3, 14 * 60 + 30, 16 * 60 + 30],
    [4, 14 * 60 + 30, 16 * 60 + 30],
  ],
  wellbeing_lead: [
    [1, 8 * 60, 15 * 60],
    [2, 8 * 60, 15 * 60],
    [3, 8 * 60, 15 * 60],
    [4, 8 * 60, 15 * 60],
    [5, 8 * 60, 11 * 60 + 30],
  ],
};
