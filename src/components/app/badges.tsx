import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const TONE = {
  neutral: "bg-muted text-muted-foreground ring-border",
  brand: "bg-brand-soft text-brand ring-brand/15",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-[oklch(0.55_0.14_65)] ring-warning/25",
  danger: "bg-danger-soft text-danger ring-danger/20",
  info: "bg-info-soft text-info ring-info/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  gold: "bg-gold-soft text-[oklch(0.5_0.1_80)] ring-gold/30",
} as const;
export type Tone = keyof typeof TONE;

export function Pill({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const REQUEST_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  IN_REVIEW: "info",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  IN_PROGRESS: "brand",
  COMPLETED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};
const CASE_TONE: Record<string, Tone> = { NEW: "info", OPEN: "brand", IN_PROGRESS: "brand", WAITING: "warning", RESOLVED: "success", CLOSED: "neutral" };
const PRIORITY_TONE: Record<string, Tone> = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", URGENT: "danger" };
const TASK_TONE: Record<string, Tone> = { TODO: "neutral", IN_PROGRESS: "brand", DONE: "success", CANCELLED: "neutral" };
const APPT_TONE: Record<string, Tone> = { SCHEDULED: "info", CONFIRMED: "brand", COMPLETED: "success", CANCELLED: "neutral", NO_SHOW: "danger" };
const SENS_TONE: Record<string, Tone> = { STANDARD: "neutral", CONFIDENTIAL: "info", MEDICAL: "warning", WELLBEING: "violet", SAFEGUARDING: "danger" };

export function RequestStatusBadge({ status, restricted }: { status: string; restricted?: boolean }) {
  const t = useTranslations("status");
  if (restricted) {
    const handled = status !== "SUBMITTED";
    return <Pill tone={handled ? "brand" : "info"} dot>{t(handled ? "beingHandled" : "received")}</Pill>;
  }
  return (
    <Pill tone={REQUEST_TONE[status] ?? "neutral"} dot>
      {t(`request.${status}`)}
    </Pill>
  );
}
export function CaseStatusBadge({ status }: { status: string }) {
  const t = useTranslations("status");
  return <Pill tone={CASE_TONE[status] ?? "neutral"} dot>{t(`case.${status}`)}</Pill>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  const t = useTranslations("status");
  return <Pill tone={PRIORITY_TONE[priority] ?? "neutral"}>{t(`priority.${priority}`)}</Pill>;
}
export function TaskStatusBadge({ status }: { status: string }) {
  const t = useTranslations("status");
  return <Pill tone={TASK_TONE[status] ?? "neutral"} dot>{t(`task.${status}`)}</Pill>;
}
export function AppointmentStatusBadge({ status }: { status: string }) {
  const t = useTranslations("status");
  return <Pill tone={APPT_TONE[status] ?? "neutral"} dot>{t(`appointment.${status}`)}</Pill>;
}
export function SensitivityBadge({ sensitivity }: { sensitivity: string }) {
  const t = useTranslations("status");
  if (sensitivity === "STANDARD") return null;
  return <Pill tone={SENS_TONE[sensitivity] ?? "neutral"}>{t(`sensitivity.${sensitivity}`)}</Pill>;
}
