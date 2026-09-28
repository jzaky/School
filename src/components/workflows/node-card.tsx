"use client";

import { createContext, memo, useContext } from "react";
import { useTranslations } from "next-intl";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  AlertCircle,
  BadgeCheck,
  Bell,
  CalendarPlus,
  CircleStop,
  ClipboardCheck,
  FileText,
  Flag,
  FolderPlus,
  GitBranch,
  Hourglass,
  Play,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Assignee, NodeConfig, NodeType, WorkflowCondition } from "@/server/workflows/graph";
import type { BuilderOptions } from "./types";

export const NODE_META: Record<NodeType, { icon: LucideIcon; tone: string }> = {
  start: { icon: Play, tone: "bg-success-soft text-success" },
  approval: { icon: BadgeCheck, tone: "bg-warning-soft text-[oklch(0.55_0.14_65)]" },
  task: { icon: ClipboardCheck, tone: "bg-brand-soft text-brand" },
  notify: { icon: Bell, tone: "bg-info-soft text-info" },
  condition: { icon: GitBranch, tone: "bg-violet-50 text-violet-700" },
  wait: { icon: Hourglass, tone: "bg-muted text-muted-foreground" },
  create_case: { icon: FolderPlus, tone: "bg-brand-soft text-brand" },
  assign: { icon: UserPlus, tone: "bg-brand-soft text-brand" },
  schedule_meeting: { icon: CalendarPlus, tone: "bg-info-soft text-info" },
  generate_document: { icon: FileText, tone: "bg-gold-soft text-[oklch(0.5_0.1_80)]" },
  update_status: { icon: Flag, tone: "bg-success-soft text-success" },
  ai_summary: { icon: Sparkles, tone: "bg-violet-50 text-violet-700" },
  end: { icon: CircleStop, tone: "bg-muted text-foreground" },
};

export type WfNode = Node<NodeConfig, NodeType>;

export type CanvasState = {
  locale: string;
  options: BuilderOptions;
  issueNodes: Set<string>;
  sim: { nodeIds: Set<string> } | null;
};

export const CanvasContext = createContext<CanvasState | null>(null);

export function labelOf(l: { en: string; ar: string } | undefined, locale: string) {
  if (!l) return "";
  return (locale === "ar" ? l.ar || l.en : l.en || l.ar) ?? "";
}

/** Human description of an assignee, for node cards and the simulation list. */
export function useDescribeAssignee() {
  const t = useTranslations("adminWorkflows");
  const tr = useTranslations("roles");
  const ctx = useContext(CanvasContext);
  return (a: Assignee | undefined) => {
    if (!a) return t("unassigned");
    switch (a.kind) {
      case "role":
        if (!a.role) return t("unassigned");
        if (a.role === "appointment_host") return t("assigneeKinds.appointment_host");
        return ctx?.options.roles.find((r) => r.key === a.role)?.name ?? (tr.has(a.role) ? tr(a.role) : a.role);
      case "member":
        return ctx?.options.staff.find((s) => s.id === a.membershipId)?.name ?? t("assigneeKinds.member");
      case "persona":
        return t("personaNamed", { persona: a.persona });
      case "department_head":
        return a.departmentKey ? t("headOf", { department: ctx?.options.departments.find((d) => d.key === a.departmentKey)?.name ?? a.departmentKey }) : t("assigneeKinds.department_head");
      default:
        return t(`assigneeKinds.${a.kind}`);
    }
  };
}

function conditionText(c: WorkflowCondition | undefined, t: ReturnType<typeof useTranslations>): string {
  if (!c) return "";
  if ("all" in c) return t("compoundAll", { count: c.all.length });
  if ("any" in c) return t("compoundAny", { count: c.any.length });
  const v = Array.isArray(c.value) ? c.value.join(", ") : c.value === undefined ? "" : String(c.value);
  return `${c.field} ${t(`ops.${c.op}`)} ${v}`.trim();
}

export function useNodeDetail() {
  const t = useTranslations("adminWorkflows");
  const ts = useTranslations("status");
  const who = useDescribeAssignee();
  const ctx = useContext(CanvasContext);
  return (type: NodeType, d: NodeConfig): string => {
    const o = ctx?.options;
    switch (type) {
      case "approval":
        return [t(`modes.${d.mode ?? "SEQUENTIAL"}`), (d.approvers ?? []).map((a) => labelOf(a.label, ctx?.locale ?? "en") || who(a.assignee)).join(", ")].filter(Boolean).join(" · ");
      case "task":
        return [who(d.assignee), d.blocking ? t("waitsForIt") : ""].filter(Boolean).join(" · ");
      case "notify":
        return [(d.recipients ?? []).map(who).join(", "), o?.messageTemplates.find((m) => m.key === d.template)?.name ?? d.template].filter(Boolean).join(" · ");
      case "condition":
        return conditionText(d.condition, t);
      case "wait":
        return t("waitFor", { days: Math.round(((d.hours ?? 0) / 24) * 100) / 100 });
      case "create_case":
        return [d.caseType ? ts(`caseType.${d.caseType}`) : "", who(d.assignee)].filter(Boolean).join(" · ");
      case "assign":
        return who(d.assignee);
      case "schedule_meeting":
        return o?.appointmentTypes.find((a) => a.key === d.appointmentTypeKey)?.name ?? d.appointmentTypeKey ?? "";
      case "generate_document":
        if (d.templateKey?.startsWith("form:")) return t("templateFromForm");
        return o?.documentTemplates.find((x) => x.key === d.templateKey)?.name ?? d.templateKey ?? "";
      case "update_status":
        return d.status ? ts(`request.${d.status}`) : "";
      case "end":
        return t(`outcomes.${d.outcome ?? "COMPLETED"}`);
      default:
        return "";
    }
  };
}

const HANDLE = "!size-3 !border-2 !border-background !bg-muted-foreground";

function NodeCardImpl({ id, type, data, selected }: NodeProps<WfNode>) {
  const t = useTranslations("adminWorkflows");
  const ctx = useContext(CanvasContext);
  const detail = useNodeDetail();
  const meta = NODE_META[type];
  const Icon = meta.icon;
  const hasIssue = ctx?.issueNodes.has(id);
  const inSim = ctx?.sim ? ctx.sim.nodeIds.has(id) : null;
  const branches = type === "condition" ? (["true", "false"] as const) : type === "approval" ? (["approved", "rejected"] as const) : null;
  const text = detail(type, data);
  return (
    <div
      className={cn(
        "relative w-[240px] rounded-xl border bg-card px-3 py-2.5 shadow-sm transition",
        selected && "ring-2 ring-brand",
        !selected && hasIssue && "border-danger/60 ring-1 ring-danger/30",
        inSim === true && "border-success ring-2 ring-success/60",
        inSim === false && "opacity-35",
      )}
      data-testid={`wf-node-${id}`}
    >
      {type !== "start" && <Handle type="target" position={Position.Top} className={HANDLE} />}
      <div className="flex items-center gap-2">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", meta.tone)}>
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t(`types.${type}`)}</span>
        {hasIssue && <AlertCircle className="size-4 shrink-0 text-danger" aria-label={t("hasProblems")} />}
      </div>
      <div className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug" dir="auto">
        {labelOf(data.label, ctx?.locale ?? "en") || <span className="text-muted-foreground">{t("untitled")}</span>}
      </div>
      {text && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
          {text}
        </div>
      )}
      {branches ? (
        <>
          <div className="mt-2 flex justify-between px-3 text-[10px] font-semibold uppercase tracking-wide">
            <span className="text-success">{t(`handles.${branches[0]}`)}</span>
            <span className="text-danger">{t(`handles.${branches[1]}`)}</span>
          </div>
          <Handle id={branches[0]} type="source" position={Position.Bottom} style={{ left: "22%" }} className="!size-3 !border-2 !border-background !bg-success" />
          <Handle id={branches[1]} type="source" position={Position.Bottom} style={{ left: "78%" }} className="!size-3 !border-2 !border-background !bg-danger" />
        </>
      ) : (
        type !== "end" && <Handle type="source" position={Position.Bottom} className={HANDLE} />
      )}
    </div>
  );
}

export const NodeCard = memo(NodeCardImpl);
