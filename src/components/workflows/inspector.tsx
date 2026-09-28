"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PickerCombobox } from "@/components/forms/picker-combobox";
import type { Assignee, NodeConfig, NodeType, WorkflowCondition } from "@/server/workflows/graph";
import { SG_ROLES } from "@/server/workflows/validate";
import { NODE_META } from "./node-card";
import type { BuilderOptions } from "./types";

type T = { en: string; ar: string };

const ASSIGNEE_KINDS = ["role", "member", "requester", "student", "guardians", "class_teacher", "department_head", "case_assignee"] as const;
const SG_KINDS = ["role", "case_assignee"] as const;
const CASE_TYPES = ["ACADEMIC", "BEHAVIOR", "WELLBEING", "SAFEGUARDING", "CAREER", "LEARNING_SUPPORT", "ATTENDANCE", "PARENT_CONCERN", "OTHER"];
const SENSITIVITIES = ["STANDARD", "CONFIDENTIAL", "MEDICAL", "WELLBEING", "SAFEGUARDING"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUSES = ["IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "IN_PROGRESS", "COMPLETED"];
const OPS = ["eq", "neq", "in", "gt", "lt", "contains", "empty", "not_empty"] as const;
const CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] as const;
const FIELD_SUGGESTIONS = ["request.hasStudent", "request.priority", "request.serviceKey", "student.grade", "form.urgency", "form.level", "form.language", "form.documentType"];

function Field({ label, children, htmlFor, hint }: { label: string; children: React.ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Pick({ value, onChange, items, placeholder, testId }: { value: string | undefined; onChange: (v: string) => void; items: Array<{ value: string; label: string }>; placeholder?: string; testId?: string }) {
  const current = items.find((i) => i.value === value);
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger className="w-full" data-testid={testId}>
        <SelectValue placeholder={placeholder}>{current?.label ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BiText({ value, onChange, idBase, labelEn, labelAr }: { value: T | undefined; onChange: (v: T) => void; idBase: string; labelEn: string; labelAr: string }) {
  const v = value ?? { en: "", ar: "" };
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <Field label={labelEn} htmlFor={`${idBase}-en`}>
        <Input id={`${idBase}-en`} dir="ltr" value={v.en} onChange={(e) => onChange({ ...v, en: e.target.value })} data-testid={`${idBase}-en`} />
      </Field>
      <Field label={labelAr} htmlFor={`${idBase}-ar`}>
        <Input id={`${idBase}-ar`} dir="rtl" value={v.ar} onChange={(e) => onChange({ ...v, ar: e.target.value })} data-testid={`${idBase}-ar`} />
      </Field>
    </div>
  );
}

function DaysInput({ id, hours, onChange, label }: { id: string; hours: number | undefined; onChange: (h: number | undefined) => void; label: string }) {
  const days = hours === undefined ? "" : String(Math.round((hours / 24) * 100) / 100);
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        min={0}
        step={0.5}
        inputMode="decimal"
        value={days}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value) * 24)))}
        data-testid={id}
      />
    </Field>
  );
}

export function AssigneeEditor({ value, onChange, options, safeguarding, idBase }: { value: Assignee | undefined; onChange: (a: Assignee) => void; options: BuilderOptions; safeguarding: boolean; idBase: string }) {
  const t = useTranslations("adminWorkflows");
  const kinds: readonly string[] = safeguarding ? SG_KINDS : ASSIGNEE_KINDS;
  const kind = value?.kind;
  const kindItems = kinds.map((k) => ({ value: k, label: t(`assigneeKinds.${k}`) }));
  if (kind && !kinds.includes(kind)) kindItems.push({ value: kind, label: t(`assigneeKinds.${kind}`) });
  const roles = (safeguarding ? options.roles.filter((r) => SG_ROLES.includes(r.key)) : options.roles).map((r) => ({ value: r.key, label: r.name }));
  if (!safeguarding) roles.push({ value: "appointment_host", label: t("assigneeKinds.appointment_host") });
  const setKind = (k: string) => {
    switch (k) {
      case "role":
        return onChange({ kind: "role", role: safeguarding ? "dsl" : (options.roles[0]?.key ?? "") });
      case "member":
        return onChange({ kind: "member", membershipId: "" });
      case "class_teacher":
        return onChange({ kind: "class_teacher" });
      case "department_head":
        return onChange({ kind: "department_head", departmentKey: options.departments[0]?.key });
      default:
        return onChange({ kind: k } as Assignee);
    }
  };
  return (
    <div className="space-y-2">
      <Pick value={kind} onChange={setKind} items={kindItems} placeholder={t("chooseAssignee")} testId={`${idBase}-kind`} />
      {value?.kind === "role" && <Pick value={value.role} onChange={(role) => onChange({ kind: "role", role })} items={roles} placeholder={t("chooseRole")} testId={`${idBase}-role`} />}
      {value?.kind === "member" && (
        <PickerCombobox
          options={options.staff.map((s) => ({ value: s.id, label: s.name, hint: s.hint, keywords: `${s.name} ${s.hint ?? ""}` }))}
          value={value.membershipId}
          onChange={(membershipId) => onChange({ kind: "member", membershipId })}
          placeholder={t("choosePerson")}
          testId={`${idBase}-member`}
        />
      )}
      {value?.kind === "persona" && <p className="text-xs text-muted-foreground">{t("personaNamed", { persona: value.persona })}</p>}
      {value?.kind === "class_teacher" && (
        <Field label={t("subjectField")} htmlFor={`${idBase}-subject`} hint={t("subjectFieldHint")}>
          <Input id={`${idBase}-subject`} dir="ltr" value={value.subjectField ?? ""} onChange={(e) => onChange({ kind: "class_teacher", subjectField: e.target.value || undefined })} />
        </Field>
      )}
      {value?.kind === "department_head" && (
        <>
          <Pick
            value={value.departmentKey ?? "__form"}
            onChange={(k) => onChange(k === "__form" ? { kind: "department_head", subjectField: value.subjectField ?? "toSubject" } : { kind: "department_head", departmentKey: k })}
            items={[...options.departments.map((d) => ({ value: d.key, label: d.name })), { value: "__form", label: t("departmentFromForm") }]}
          />
          {!value.departmentKey && (
            <Field label={t("subjectField")} htmlFor={`${idBase}-dsubject`} hint={t("subjectFieldHint")}>
              <Input id={`${idBase}-dsubject`} dir="ltr" value={value.subjectField ?? ""} onChange={(e) => onChange({ kind: "department_head", subjectField: e.target.value })} />
            </Field>
          )}
        </>
      )}
    </div>
  );
}

function parseValue(raw: string, op: string): unknown {
  if (op === "in") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if ((op === "gt" || op === "lt") && raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function ConditionEditor({ value, onChange }: { value: WorkflowCondition | undefined; onChange: (c: WorkflowCondition) => void }) {
  const t = useTranslations("adminWorkflows");
  if (value && ("all" in value || "any" in value)) return <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{t("compoundReadOnly")}</p>;
  const c = (value ?? { field: "", op: "eq", value: "" }) as Extract<WorkflowCondition, { field: string }>;
  const raw = Array.isArray(c.value) ? c.value.join(", ") : c.value === undefined || c.value === null ? "" : String(c.value);
  return (
    <div className="space-y-3">
      <Field label={t("conditionField")} htmlFor="wf-cond-field" hint={t("conditionFieldHint")}>
        <Input id="wf-cond-field" dir="ltr" list="wf-cond-fields" value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value })} data-testid="wf-cond-field" />
        <datalist id="wf-cond-fields">
          {FIELD_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Field>
      <Field label={t("conditionOp")}>
        <Pick value={c.op} onChange={(op) => onChange({ ...c, op: op as typeof c.op, value: op === "empty" || op === "not_empty" ? undefined : parseValue(raw, op) })} items={OPS.map((o) => ({ value: o, label: t(`ops.${o}`) }))} />
      </Field>
      {c.op !== "empty" && c.op !== "not_empty" && (
        <Field label={t("conditionValue")} htmlFor="wf-cond-value" hint={c.op === "in" ? t("conditionValueList") : t("conditionValueHint")}>
          <Input id="wf-cond-value" dir="ltr" value={raw} onChange={(e) => onChange({ ...c, value: parseValue(e.target.value, c.op) })} data-testid="wf-cond-value" />
        </Field>
      )}
    </div>
  );
}

export function NodeInspector({
  id,
  type,
  data,
  onChange,
  onDelete,
  options,
  safeguarding,
}: {
  id: string;
  type: NodeType;
  data: NodeConfig;
  onChange: (d: NodeConfig) => void;
  onDelete: () => void;
  options: BuilderOptions;
  safeguarding: boolean;
}) {
  const t = useTranslations("adminWorkflows");
  const ts = useTranslations("status");
  const Icon = NODE_META[type].icon;
  const set = (patch: Partial<NodeConfig>) => onChange({ ...data, ...patch });
  const assignee = (label = t("assignee")) => (
    <Field label={label}>
      <AssigneeEditor idBase="wf-assignee" value={data.assignee} onChange={(a) => set({ assignee: a })} options={options} safeguarding={safeguarding} />
    </Field>
  );
  const docItems = [...options.documentTemplates.map((d) => ({ value: d.key, label: d.name })), { value: "form:documentType", label: t("templateFromForm") }];

  return (
    <div className="space-y-4" data-testid="wf-inspector">
      <div className="flex items-center gap-2">
        <span className={`grid size-8 place-items-center rounded-lg ${NODE_META[type].tone}`}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t(`types.${type}`)}</div>
          <div className="truncate text-xs text-muted-foreground">{t(`typeHints.${type}`)}</div>
        </div>
        {type === "start" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="ghost" size="icon-sm" disabled aria-label={t("deleteStep")}>
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("startLocked")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={t("deleteStep")} data-testid="wf-delete-node">
            <Trash2 className="size-4 text-danger" />
          </Button>
        )}
      </div>

      <BiText idBase="wf-label" value={data.label} onChange={(label) => set({ label })} labelEn={t("labelEn")} labelAr={t("labelAr")} />

      {type === "approval" && (
        <>
          <Field label={t("approvalMode")}>
            <Pick value={data.mode ?? "SEQUENTIAL"} onChange={(mode) => set({ mode: mode as NodeConfig["mode"] })} items={(["SEQUENTIAL", "PARALLEL_ALL", "PARALLEL_ANY"] as const).map((m) => ({ value: m, label: t(`modes.${m}`) }))} testId="wf-mode" />
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">{t(`modeHints.${data.mode ?? "SEQUENTIAL"}`)}</p>
          <div className="space-y-2">
            <div className="text-xs font-medium">{t("approvers")}</div>
            {(data.approvers ?? []).map((ap, i) => (
              <div key={i} className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{data.mode === "SEQUENTIAL" ? t("approverStep", { n: i + 1 }) : t("approverN", { n: i + 1 })}</span>
                  <Button variant="ghost" size="icon-xs" aria-label={t("removeApprover")} onClick={() => set({ approvers: (data.approvers ?? []).filter((_, j) => j !== i) })}>
                    <X />
                  </Button>
                </div>
                <AssigneeEditor
                  idBase={`wf-approver-${i}`}
                  value={ap.assignee}
                  onChange={(a) => set({ approvers: (data.approvers ?? []).map((x, j) => (j === i ? { ...x, assignee: a } : x)) })}
                  options={options}
                  safeguarding={safeguarding}
                />
                <BiText idBase={`wf-approver-${i}-label`} value={ap.label} onChange={(label) => set({ approvers: (data.approvers ?? []).map((x, j) => (j === i ? { ...x, label } : x)) })} labelEn={t("approverLabelEn")} labelAr={t("approverLabelAr")} />
                <label className="flex items-center justify-between gap-2 text-xs">
                  <span>{t("requireSignature")}</span>
                  <Switch checked={Boolean(ap.requireSignature)} onCheckedChange={(v) => set({ approvers: (data.approvers ?? []).map((x, j) => (j === i ? { ...x, requireSignature: v } : x)) })} />
                </label>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              data-testid="wf-add-approver"
              onClick={() =>
                set({
                  approvers: [
                    ...(data.approvers ?? []),
                    safeguarding
                      ? { assignee: { kind: "role", role: "deputy_dsl" }, label: { en: options.roles.find((r) => r.key === "deputy_dsl")?.name ?? "", ar: "" } }
                      : { assignee: { kind: "role", role: "" }, label: { en: "", ar: "" } },
                  ],
                })
              }
            >
              <Plus className="size-4" />
              {t("addApprover")}
            </Button>
          </div>
          <DaysInput id="wf-due" hours={data.dueInHours} onChange={(dueInHours) => set({ dueInHours })} label={t("dueInDays")} />
        </>
      )}

      {(type === "task" || type === "schedule_meeting") && (
        <>
          {type === "schedule_meeting" && (
            <Field label={t("appointmentType")}>
              <Pick value={data.appointmentTypeKey} onChange={(appointmentTypeKey) => set({ appointmentTypeKey })} items={options.appointmentTypes.map((a) => ({ value: a.key, label: a.name }))} placeholder={t("choose")} />
            </Field>
          )}
          {assignee()}
          <BiText idBase="wf-title" value={data.title} onChange={(title) => set({ title })} labelEn={t("taskTitleEn")} labelAr={t("taskTitleAr")} />
          <DaysInput id="wf-due" hours={data.dueInHours} onChange={(dueInHours) => set({ dueInHours })} label={t("dueInDays")} />
          {type === "task" && (
            <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">{t("blocking")}</span>
                <span className="block text-xs text-muted-foreground">{t("blockingHint")}</span>
              </span>
              <Switch checked={Boolean(data.blocking)} onCheckedChange={(blocking) => set({ blocking })} data-testid="wf-blocking" />
            </label>
          )}
        </>
      )}

      {type === "assign" && assignee(t("newOwner"))}

      {type === "notify" && (
        <>
          <Field label={t("template")}>
            <Pick value={data.template} onChange={(template) => set({ template })} items={options.messageTemplates.map((m) => ({ value: m.key, label: m.name }))} placeholder={t("choose")} testId="wf-template" />
          </Field>
          <div className="space-y-2">
            <div className="text-xs font-medium">{t("recipients")}</div>
            {(data.recipients ?? []).map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <AssigneeEditor idBase={`wf-recipient-${i}`} value={r} onChange={(a) => set({ recipients: (data.recipients ?? []).map((x, j) => (j === i ? a : x)) })} options={options} safeguarding={safeguarding} />
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t("removeRecipient")} onClick={() => set({ recipients: (data.recipients ?? []).filter((_, j) => j !== i) })}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" onClick={() => set({ recipients: [...(data.recipients ?? []), safeguarding ? { kind: "role", role: "dsl" } : { kind: "requester" }] })}>
              <Plus className="size-4" />
              {t("addRecipient")}
            </Button>
            {!safeguarding && <p className="text-xs text-muted-foreground">{t("familyGuard")}</p>}
          </div>
          <Field label={t("channels")}>
            <div className="grid grid-cols-2 gap-2">
              {CHANNELS.map((ch) => {
                const on = (data.channels ?? ["IN_APP"]).includes(ch);
                return (
                  <label key={ch} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) => {
                        const cur = data.channels ?? ["IN_APP"];
                        set({ channels: v ? [...cur.filter((c) => c !== ch), ch] : cur.filter((c) => c !== ch) });
                      }}
                    />
                    {t(`channelNames.${ch}`)}
                  </label>
                );
              })}
            </div>
          </Field>
        </>
      )}

      {type === "condition" && <ConditionEditor value={data.condition} onChange={(condition) => set({ condition })} />}

      {type === "wait" && <DaysInput id="wf-wait" hours={data.hours} onChange={(hours) => set({ hours })} label={t("waitDays")} />}

      {type === "create_case" && (
        <>
          <Field label={t("caseType")}>
            <Pick value={data.caseType} onChange={(caseType) => set({ caseType })} items={CASE_TYPES.map((c) => ({ value: c, label: ts(`caseType.${c}`) }))} placeholder={t("choose")} />
          </Field>
          <Field label={t("sensitivity")}>
            <Pick value={data.sensitivity ?? "STANDARD"} onChange={(sensitivity) => set({ sensitivity })} items={SENSITIVITIES.map((s) => ({ value: s, label: ts(`sensitivity.${s}`) }))} />
          </Field>
          <Field label={t("priority")}>
            <Pick
              value={data.priority ?? "MEDIUM"}
              onChange={(priority) => set({ priority })}
              items={[...PRIORITIES.map((p) => ({ value: p, label: ts(`priority.${p}`) })), ...(data.priority?.startsWith("form:") ? [{ value: data.priority, label: t("priorityFromForm", { field: data.priority.slice(5) }) }] : [])]}
            />
          </Field>
          {assignee(t("caseOwner"))}
        </>
      )}

      {type === "generate_document" && (
        <>
          <Field label={t("documentTemplate")}>
            <Pick value={data.templateKey} onChange={(templateKey) => set({ templateKey })} items={docItems} placeholder={t("choose")} />
          </Field>
          <Field label={t("documentLanguage")}>
            <Pick value={data.output ?? "BILINGUAL"} onChange={(output) => set({ output: output as NodeConfig["output"] })} items={(["EN", "AR", "BILINGUAL"] as const).map((o) => ({ value: o, label: t(`outputs.${o}`) }))} />
          </Field>
        </>
      )}

      {type === "update_status" && (
        <>
          <Field label={t("statusToSet")}>
            <Pick value={data.status} onChange={(status) => set({ status })} items={STATUSES.map((s) => ({ value: s, label: ts(`request.${s}`) }))} placeholder={t("choose")} />
          </Field>
          <Field label={t("progress")} htmlFor="wf-progress">
            <Input id="wf-progress" type="number" min={0} max={100} value={data.progress ?? ""} onChange={(e) => set({ progress: e.target.value === "" ? undefined : Math.min(100, Math.max(0, Number(e.target.value))) })} />
          </Field>
        </>
      )}

      {type === "end" && (
        <Field label={t("outcome")}>
          <Pick value={data.outcome ?? "COMPLETED"} onChange={(outcome) => set({ outcome: outcome as NodeConfig["outcome"] })} items={(["COMPLETED", "REJECTED", "CANCELLED"] as const).map((o) => ({ value: o, label: t(`outcomes.${o}`) }))} />
        </Field>
      )}

      <p className="text-xs text-muted-foreground">
        {t("stepId")}: <code dir="ltr">{id}</code>
      </p>
    </div>
  );
}
