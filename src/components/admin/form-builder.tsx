"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  AlignLeft,
  ArrowLeft,
  ArrowRight,
  AtSign,
  BookOpen,
  Calendar,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Clock,
  Eye,
  FileCheck2,
  GitBranch,
  GraduationCap,
  GripVertical,
  Hash,
  Info,
  Layers,
  ListChecks,
  Loader2,
  Paperclip,
  PenLine,
  Phone,
  Plus,
  Rocket,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  ToggleLeft,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Pill } from "@/components/app/badges";
import { Panel, PanelHeader } from "@/components/app/panel";
import { FormRenderer, type RendererOptions } from "@/components/forms/form-renderer";
import type { FieldType, FormField, FormSchema, FormSection, FormStep } from "@/server/forms/schema";
import { PALETTE, conditionRefs, fieldCount, fieldsOf, isSimpleCondition, newField, newSection, newStep, renameInCondition, schemaIssues, uid, type SchemaIssue } from "@/server/forms/builder";
import { discardAiDraftAction, discardFormDraftAction, draftFormWithAiAction, publishFormAction, saveFormDraftAction } from "@/server/admin/forms-actions";
import { BiInput, FieldInspector, SectionInspector, StepInspector, tx } from "./form-inspector";

type Meta = { nameEn: string; nameAr: string; descEn: string; descAr: string; categoryEn: string; categoryAr: string };
type Sel = { kind: "field"; id: string } | { kind: "section"; id: string } | { kind: "step" } | null;
type VersionRow = { id: string; version: number; when: string; by: string; submissions: number; current: boolean };
type ServiceRow = { id: string; key: string; name: string; active: boolean };

const TYPE_ICON: Record<FieldType, LucideIcon> = {
  short_text: Type,
  long_text: AlignLeft,
  number: Hash,
  email: AtSign,
  phone: Phone,
  date: Calendar,
  time: Clock,
  select: ChevronDown,
  multi_select: ListChecks,
  radio: CircleDot,
  checkbox: CheckSquare,
  yes_no: ToggleLeft,
  rating: Star,
  scale: SlidersHorizontal,
  file: Paperclip,
  signature: PenLine,
  statement: Info,
  student_picker: GraduationCap,
  staff_picker: UserRound,
  subject_picker: BookOpen,
  consent: ShieldCheck,
};

const SECTION = "section:";
const PALETTE_ID = "palette:";

export function FormBuilder({
  formId,
  initialMeta,
  initialSchema,
  publishedVersion,
  hasUnpublishedChanges,
  versions,
  services,
  options,
  openAi,
}: {
  formId: string | null;
  initialMeta: Meta;
  initialSchema: FormSchema;
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
  versions: VersionRow[];
  services: ServiceRow[];
  options: RendererOptions;
  openAi: boolean;
}) {
  const t = useTranslations("adminForms");
  const locale = useLocale();
  const router = useRouter();
  const [meta, setMeta] = useState<Meta>(initialMeta);
  const [schema, setSchema] = useState<FormSchema>(initialSchema);
  const [stepIdx, setStepIdx] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState("build");
  const [previewKey, setPreviewKey] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(openAi);
  const [ai, setAi] = useState<{ interactionId: string; provider: string; before: { schema: FormSchema; meta: Meta } } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [pending, start] = useTransition();

  const step = schema.steps[Math.min(stepIdx, schema.steps.length - 1)];
  const allFields = useMemo(() => fieldsOf(schema), [schema]);
  const takenIds = useMemo(() => new Set(allFields.map((f) => f.id)), [allFields]);
  const issues = useMemo(() => schemaIssues(schema), [schema]);
  const nameMissing = !meta.nameEn.trim() || !meta.nameAr.trim();
  const isDraftOnly = publishedVersion === null;

  // Warn before leaving with unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const edit = useCallback((fn: (s: FormSchema) => FormSchema) => {
    setSchema((s) => fn(s));
    setDirty(true);
  }, []);

  const editStep = useCallback(
    (fn: (st: FormStep) => FormStep) => edit((s) => ({ ...s, steps: s.steps.map((st, i) => (i === Math.min(stepIdx, s.steps.length - 1) ? fn(st) : st)) })),
    [edit, stepIdx],
  );

  const mapFields = (s: FormSchema, fn: (f: FormField) => FormField): FormSchema => ({
    ...s,
    steps: s.steps.map((st) => ({ ...st, sections: st.sections.map((sec) => ({ ...sec, showIf: sec.showIf, fields: sec.fields.map(fn) })) })),
  });

  const updateField = (id: string, patch: Partial<FormField>) =>
    edit((s) =>
      mapFields(s, (f) => {
        if (f.id !== id) return f;
        const next = { ...f, ...patch } as FormField;
        for (const k of Object.keys(next) as Array<keyof FormField>) if (next[k] === undefined) delete next[k];
        return next;
      }),
    );

  const renameField = (from: string, to: string) => {
    edit((s) => {
      const renamed = mapFields(s, (f) => ({ ...(f.id === from ? { ...f, id: to } : f), ...(f.showIf ? { showIf: renameInCondition(f.showIf, from, to) } : {}) }));
      return { ...renamed, steps: renamed.steps.map((st) => ({ ...st, sections: st.sections.map((sec) => (sec.showIf ? { ...sec, showIf: renameInCondition(sec.showIf, from, to) } : sec)) })) };
    });
    setSel({ kind: "field", id: to });
  };

  const sectionOf = (fieldId: string) => step.sections.find((sec) => sec.fields.some((f) => f.id === fieldId));

  const addField = (type: FieldType, sectionId?: string, index?: number) => {
    const f = newField(type, takenIds);
    const target = sectionId ?? (sel?.kind === "section" ? sel.id : sel?.kind === "field" ? sectionOf(sel.id)?.id : undefined) ?? step.sections[step.sections.length - 1].id;
    editStep((st) => ({
      ...st,
      sections: st.sections.map((sec) => {
        if (sec.id !== target) return sec;
        const fields = [...sec.fields];
        fields.splice(index ?? fields.length, 0, f);
        return { ...sec, fields };
      }),
    }));
    setSel({ kind: "field", id: f.id });
    toast.success(t("fieldAdded", { type: t(`types.${type}`) }));
  };

  const duplicateField = (id: string) => {
    const src = allFields.find((f) => f.id === id);
    if (!src) return;
    let nid = `${src.id}_copy`;
    while (takenIds.has(nid)) nid = uid(src.id.slice(0, 20));
    const copy: FormField = { ...structuredClone(src), id: nid };
    edit((s) => ({
      ...s,
      steps: s.steps.map((st) => ({ ...st, sections: st.sections.map((sec) => ({ ...sec, fields: sec.fields.flatMap((f) => (f.id === id ? [f, copy] : [f])) })) })),
    }));
    setSel({ kind: "field", id: nid });
  };

  const deleteField = (id: string) => {
    const refersTo = (x: { showIf?: FormField["showIf"] }) => isSimpleCondition(x.showIf) && x.showIf.fieldId === id;
    const cleared = schema.steps.reduce((n, st) => n + st.sections.reduce((m, sec) => m + (refersTo(sec) ? 1 : 0) + sec.fields.filter((f) => f.id !== id && refersTo(f)).length, 0), 0);
    edit((s) => {
      const strip = <T extends { showIf?: FormField["showIf"] }>(x: T): T => {
        if (refersTo(x)) {
          const { showIf: _drop, ...rest } = x;
          return rest as T;
        }
        return x;
      };
      return {
        ...s,
        steps: s.steps.map((st) => ({ ...st, sections: st.sections.map((sec) => strip({ ...sec, fields: sec.fields.filter((f) => f.id !== id).map(strip) })) })),
      };
    });
    setSel(null);
    toast.success(cleared ? t("fieldDeletedRules", { count: cleared }) : t("fieldDeleted"));
  };

  const addSection = () => {
    const sec = newSection();
    editStep((st) => ({ ...st, sections: [...st.sections, sec] }));
    setSel({ kind: "section", id: sec.id });
  };

  const addStep = () => {
    const st = newStep(schema.steps.length + 1);
    edit((s) => ({ ...s, steps: [...s.steps, st] }));
    setStepIdx(schema.steps.length);
    setSel({ kind: "step" });
  };

  // -------------------------------------------------------------------------
  // Drag and drop
  // -------------------------------------------------------------------------

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const collision: CollisionDetection = useCallback((args) => {
    const hits = pointerWithin(args);
    if (hits.length) {
      const field = hits.find((h) => !String(h.id).startsWith(SECTION));
      return field ? [field] : hits;
    }
    return closestCorners(args);
  }, []);

  const labelOf = (id: UniqueIdentifier | undefined) => {
    const s = String(id ?? "");
    if (s.startsWith(PALETTE_ID)) return t(`types.${s.slice(PALETTE_ID.length)}`);
    if (s.startsWith(SECTION)) {
      const i = step.sections.findIndex((sec) => sec.id === s.slice(SECTION.length));
      const sec = step.sections[i];
      return sec?.title ? tx(locale, sec.title) : t("sectionN", { n: i + 1 });
    }
    const f = allFields.find((x) => x.id === s);
    return f ? tx(locale, f.label) || f.id : s;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.picked", { item: labelOf(active.id) }),
    onDragOver: ({ active, over }) => (over ? t("dnd.over", { item: labelOf(active.id), target: labelOf(over.id) }) : t("dnd.outside", { item: labelOf(active.id) })),
    onDragEnd: ({ active, over }) => (over ? t("dnd.dropped", { item: labelOf(active.id), target: labelOf(over.id) }) : t("dnd.cancelled", { item: labelOf(active.id) })),
    onDragCancel: ({ active }) => t("dnd.cancelled", { item: labelOf(active.id) }),
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a.startsWith(PALETTE_ID) || a === o) return;
    const from = sectionOf(a)?.id;
    const to = o.startsWith(SECTION) ? o.slice(SECTION.length) : sectionOf(o)?.id;
    if (!from || !to || from === to) return;
    editStep((st) => {
      const moving = st.sections.find((s) => s.id === from)?.fields.find((f) => f.id === a);
      if (!moving) return st;
      return {
        ...st,
        sections: st.sections.map((sec) => {
          if (sec.id === from) return { ...sec, fields: sec.fields.filter((f) => f.id !== a) };
          if (sec.id === to) {
            const idx = sec.fields.findIndex((f) => f.id === o);
            const fields = [...sec.fields];
            fields.splice(idx < 0 ? fields.length : idx, 0, moving);
            return { ...sec, fields };
          }
          return sec;
        }),
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a.startsWith(PALETTE_ID)) {
      const type = a.slice(PALETTE_ID.length) as FieldType;
      if (o.startsWith(SECTION)) return addField(type, o.slice(SECTION.length));
      const sec = sectionOf(o);
      if (sec) return addField(type, sec.id, sec.fields.findIndex((f) => f.id === o));
      return;
    }
    if (a === o || o.startsWith(SECTION)) return;
    const sec = sectionOf(a);
    if (!sec || !sec.fields.some((f) => f.id === o)) return;
    const from = sec.fields.findIndex((f) => f.id === a);
    const to = sec.fields.findIndex((f) => f.id === o);
    editStep((st) => ({ ...st, sections: st.sections.map((s) => (s.id === sec.id ? { ...s, fields: arrayMove(s.fields, from, to) } : s)) }));
  };

  // -------------------------------------------------------------------------
  // Save and publish
  // -------------------------------------------------------------------------

  const err = (code?: string) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));
  const payload = () => ({ formId, meta, schema, aiInteractionId: ai?.interactionId ?? null });

  const afterSave = (id: string) => {
    setDirty(false);
    setAi(null);
    if (!formId) router.replace(`/admin/forms/${id}`);
    else router.refresh();
  };

  const save = () => {
    if (nameMissing) {
      toast.error(t("errors.NAME"));
      document.getElementById("form-name-en")?.focus();
      return;
    }
    start(async () => {
      const res = await saveFormDraftAction(payload());
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("savedDraft"));
      afterSave(res.formId);
    });
  };

  const publish = () =>
    start(async () => {
      const res = await publishFormAction(payload());
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("publishedVersion", { version: res.version }));
      setPublishOpen(false);
      afterSave(res.formId);
    });

  const discardChanges = () =>
    start(async () => {
      if (!formId) return;
      const res = await discardFormDraftAction({ formId });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("changesDiscarded"));
      setDirty(false);
      window.location.reload();
    });

  const applyAi = (draft: { name: { en: string; ar: string }; description: { en: string; ar: string }; schema: FormSchema }, interactionId: string, provider: string) => {
    setAi({ interactionId, provider, before: { schema, meta } });
    setSchema(draft.schema);
    setMeta((m) => ({
      ...m,
      nameEn: m.nameEn || draft.name.en,
      nameAr: m.nameAr || draft.name.ar,
      descEn: m.descEn || draft.description.en,
      descAr: m.descAr || draft.description.ar,
    }));
    setStepIdx(0);
    setSel(null);
    setDirty(true);
    setTab("build");
  };

  const discardAi = () => {
    if (!ai) return;
    setSchema(ai.before.schema);
    setMeta(ai.before.meta);
    const id = ai.interactionId;
    setAi(null);
    setSel(null);
    setStepIdx(0);
    void discardAiDraftAction({ interactionId: id });
    toast.success(t("aiDiscarded"));
  };

  const goToIssue = (i: SchemaIssue) => {
    setPublishOpen(false);
    setTab("build");
    if ("fieldId" in i) {
      const si = schema.steps.findIndex((st) => st.sections.some((sec) => sec.fields.some((f) => f.id === i.fieldId)));
      if (si >= 0) setStepIdx(si);
      setSel({ kind: "field", id: i.fieldId });
    } else if ("stepId" in i) {
      setStepIdx(Math.max(0, schema.steps.findIndex((st) => st.id === i.stepId)));
      setSel({ kind: "step" });
    }
  };

  const issueText = (i: SchemaIssue) => {
    if (i.code === "noFields") return t("issues.noFields");
    if (i.code === "stepTitle") return t("issues.stepTitle", { step: tx(locale, schema.steps.find((s) => s.id === i.stepId)?.title) || i.stepId });
    const f = allFields.find((x) => x.id === i.fieldId);
    return t(`issues.${i.code}`, { field: (f && tx(locale, f.label)) || i.fieldId });
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const selField = sel?.kind === "field" ? allFields.find((f) => f.id === sel.id) : undefined;
  const selSection = sel?.kind === "section" ? step.sections.find((s) => s.id === sel.id) : undefined;
  const candidatesFor = (selfId?: string) => allFields.filter((f) => f.id !== selfId && f.type !== "statement" && f.type !== "file" && f.type !== "signature");
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const activeField = activeId && !activeId.startsWith(PALETTE_ID) ? allFields.find((f) => f.id === activeId) : undefined;
  const activeType = activeId?.startsWith(PALETTE_ID) ? (activeId.slice(PALETTE_ID.length) as FieldType) : activeField?.type;
  const title = (locale === "ar" ? meta.nameAr || meta.nameEn : meta.nameEn || meta.nameAr) || t("untitled");

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/admin/forms" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <Back className="size-4" />
        {t("title")}
      </Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight" data-testid="builder-title">
            {title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isDraftOnly ? (
              <Pill tone="warning" dot>
                {t("stateDraft")}
              </Pill>
            ) : (
              <Pill tone="success" dot>
                {t("versionN", { version: publishedVersion })}
              </Pill>
            )}
            {!isDraftOnly && hasUnpublishedChanges && !dirty && <Pill tone="info">{t("stateChanged")}</Pill>}
            {dirty && (
              <Pill tone="warning">{t("unsaved")}</Pill>
            )}
            <span className="text-xs text-muted-foreground">{t("fieldsN", { count: fieldCount(schema) })}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setAiOpen(true)} data-testid="builder-ai">
            <Sparkles className="size-4" />
            {t("draftWithAi")}
          </Button>
          <Button variant="outline" onClick={save} disabled={pending} data-testid="builder-save">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("saveDraft")}
          </Button>
          <Button
            onClick={() => {
              if (nameMissing) {
                toast.error(t("errors.NAME"));
                document.getElementById("form-name-en")?.focus();
                return;
              }
              setPublishOpen(true);
            }}
            disabled={pending}
            data-testid="builder-publish"
          >
            <Rocket className="size-4" />
            {t("publish")}
          </Button>
        </div>
      </div>

      {ai && (
        <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900 sm:flex-row sm:items-center" data-testid="ai-banner">
          <Sparkles className="size-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{t("aiBannerTitle")}</p>
            <p className="text-violet-800/80">{ai.provider.startsWith("anthropic") ? t("aiBannerModel") : t("aiBannerBuiltIn")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={discardAi} className="bg-white">
            {t("aiDiscard")}
          </Button>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          if (v === "preview") setPreviewKey((k) => k + 1);
        }}
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="build" data-testid="tab-build">
            <Layers className="size-4" />
            {t("tabBuild")}
          </TabsTrigger>
          <TabsTrigger value="preview" data-testid="tab-preview">
            <Eye className="size-4" />
            {t("tabPreview")}
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings2 className="size-4" />
            {t("tabSettings")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="build" className="mt-2">
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
            accessibility={{ announcements, screenReaderInstructions: { draggable: t("dnd.instructions") } }}
          >
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
              {/* Palette */}
              <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto" aria-label={t("palette")}>
                <Panel className="p-3">
                  <h2 className="px-1 text-sm font-semibold">{t("palette")}</h2>
                  <p className="mb-3 px-1 text-xs text-muted-foreground">{t("paletteHint")}</p>
                  <div className="space-y-3">
                    {PALETTE.map((g) => (
                      <div key={g.group}>
                        <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t(`groups.${g.group}`)}</div>
                        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
                          {g.types.map((type) => (
                            <PaletteItem key={type} type={type} label={t(`types.${type}`)} addLabel={t("addType", { type: t(`types.${type}`) })} onAdd={() => addField(type)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </aside>

              {/* Canvas */}
              <div className="min-w-0 space-y-3">
                <Panel className="p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="form-name-en" className="text-xs text-muted-foreground">
                        {t("nameEn")}
                      </Label>
                      <Input id="form-name-en" dir="ltr" value={meta.nameEn} onChange={(e) => (setMeta({ ...meta, nameEn: e.target.value }), setDirty(true))} placeholder={t("namePlaceholderEn")} aria-invalid={!meta.nameEn.trim() && dirty} data-testid="form-name-en" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="form-name-ar" className="text-xs text-muted-foreground">
                        {t("nameAr")}
                      </Label>
                      <Input id="form-name-ar" dir="rtl" value={meta.nameAr} onChange={(e) => (setMeta({ ...meta, nameAr: e.target.value }), setDirty(true))} placeholder={t("namePlaceholderAr")} aria-invalid={!meta.nameAr.trim() && dirty} data-testid="form-name-ar" />
                    </div>
                  </div>
                </Panel>

                <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t("steps")}>
                  {schema.steps.map((st, i) => (
                    <button
                      key={st.id}
                      type="button"
                      role="tab"
                      aria-selected={i === stepIdx}
                      onClick={() => {
                        setStepIdx(i);
                        setSel({ kind: "step" });
                      }}
                      className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition", i === stepIdx ? "border-brand bg-brand-soft text-brand" : "bg-card hover:bg-muted")}
                      data-testid={`step-${i}`}
                    >
                      <span className="grid size-5 place-items-center rounded-full bg-card text-[11px] tabular-nums ring-1 ring-border">{i + 1}</span>
                      {tx(locale, st.title) || t("stepN", { n: i + 1 })}
                    </button>
                  ))}
                  <Button variant="ghost" size="sm" onClick={addStep} data-testid="add-step">
                    <Plus className="size-4" />
                    {t("addStep")}
                  </Button>
                </div>

                {step.sections.map((sec, i) => (
                  <SectionCard
                    key={sec.id}
                    section={sec}
                    index={i}
                    selected={sel?.kind === "section" && sel.id === sec.id}
                    selectedField={sel?.kind === "field" ? sel.id : null}
                    dragging={Boolean(activeId)}
                    onSelect={() => setSel({ kind: "section", id: sec.id })}
                    onSelectField={(id) => setSel({ kind: "field", id })}
                  />
                ))}
                <Button variant="outline" className="w-full border-dashed" onClick={addSection} data-testid="add-section">
                  <Plus className="size-4" />
                  {t("addSection")}
                </Button>
              </div>

              {/* Inspector */}
              <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto" aria-label={t("inspector")}>
                <Panel className="p-4">
                  {selField ? (
                    <FieldInspector
                      key={selField.id}
                      field={selField}
                      candidates={candidatesFor(selField.id)}
                      takenIds={takenIds}
                      onChange={(p) => updateField(selField.id, p)}
                      onRename={(to) => renameField(selField.id, to)}
                      onDuplicate={() => duplicateField(selField.id)}
                      onDelete={() => deleteField(selField.id)}
                    />
                  ) : selSection ? (
                    <SectionInspector
                      key={selSection.id}
                      section={selSection}
                      candidates={candidatesFor().filter((f) => !selSection.fields.some((x) => x.id === f.id))}
                      canDelete={step.sections.length > 1}
                      onChange={(p) => editStep((st) => ({ ...st, sections: st.sections.map((s) => (s.id === selSection.id ? dropUndef({ ...s, ...p }) : s)) }))}
                      onDelete={() => {
                        editStep((st) => ({ ...st, sections: st.sections.filter((s) => s.id !== selSection.id) }));
                        setSel(null);
                      }}
                    />
                  ) : sel?.kind === "step" ? (
                    <StepInspector
                      key={step.id}
                      step={step}
                      canDelete={schema.steps.length > 1}
                      onChange={(p) => editStep((st) => ({ ...st, ...p }))}
                      onDelete={() => {
                        edit((s) => ({ ...s, steps: s.steps.filter((st) => st.id !== step.id) }));
                        setStepIdx(0);
                        setSel(null);
                      }}
                    />
                  ) : (
                    <div className="py-6 text-center">
                      <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                        <Settings2 className="size-5" />
                      </div>
                      <p className="text-sm font-medium">{t("inspectorEmpty")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t("inspectorEmptyBody")}</p>
                    </div>
                  )}
                </Panel>
              </aside>
            </div>
            <DragOverlay dropAnimation={null}>
              {activeType ? (
                <div className="flex items-center gap-2 rounded-lg border border-brand bg-card px-3 py-2 text-sm font-medium shadow-lg">
                  <GripVertical className="size-4 text-muted-foreground" />
                  <TypeIcon type={activeType} />
                  {activeField ? tx(locale, activeField.label) : t(`types.${activeType}`)}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </TabsContent>

        <TabsContent value="preview" className="mt-2">
          <div className="mx-auto max-w-3xl space-y-3">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Eye className="size-4" />
              {t("previewNote")}
            </div>
            <Panel className="p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">{title}</h2>
                {(locale === "ar" ? meta.descAr || meta.descEn : meta.descEn || meta.descAr) && <p className="mt-1 text-sm text-muted-foreground">{locale === "ar" ? meta.descAr || meta.descEn : meta.descEn || meta.descAr}</p>}
              </div>
              {fieldCount(schema) || fieldsOf(schema).length ? (
                <div data-testid="preview-form">
                  <FormRenderer key={previewKey} schema={schema} options={options} preview onSubmit={async () => undefined} />
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("previewEmpty")}</p>
              )}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-2">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Panel>
              <PanelHeader title={t("aboutForm")} description={t("aboutFormBody")} />
              <div className="space-y-4">
                <BiInput id="form-desc" label={t("description")} value={{ en: meta.descEn, ar: meta.descAr }} onChange={(v) => (setMeta({ ...meta, descEn: v?.en ?? "", descAr: v?.ar ?? "" }), setDirty(true))} multiline optional />
                <BiInput id="form-cat" label={t("category")} value={{ en: meta.categoryEn, ar: meta.categoryAr }} onChange={(v) => (setMeta({ ...meta, categoryEn: v?.en ?? "", categoryAr: v?.ar ?? "" }), setDirty(true))} optional />
                <BiInput id="form-submit" label={t("submitLabel")} value={schema.submitLabel} onChange={(v) => edit((s) => dropUndef({ ...s, submitLabel: v }))} optional />
              </div>
            </Panel>
            <div className="space-y-4">
              <Panel>
                <PanelHeader title={t("usedBy")} description={t("usedByBody")} />
                {services.length ? (
                  <ul className="space-y-1.5">
                    {services.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                        <Link href={`/admin/services?q=${encodeURIComponent(s.name)}`} className="truncate hover:text-brand">
                          {s.name}
                        </Link>
                        {!s.active && <Pill>{t("serviceOff")}</Pill>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noServicesYet")}</p>
                )}
              </Panel>
              <Panel>
                <PanelHeader title={t("versions")} description={t("versionsBody")} />
                {versions.length ? (
                  <ol className="space-y-2" data-testid="version-list">
                    {versions.map((v) => (
                      <li key={v.id} className="flex items-start gap-3 rounded-lg border p-2.5">
                        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums", v.current ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>{v.version}</span>
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{t("versionN", { version: v.version })}</span>
                            {v.current && <Pill tone="success">{t("live")}</Pill>}
                          </div>
                          <div className="text-muted-foreground">{v.by ? t("publishedBy", { when: v.when, name: v.by }) : v.when}</div>
                          <div className="text-muted-foreground">{t("submissions", { count: v.submissions })}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noVersions")}</p>
                )}
                {!isDraftOnly && hasUnpublishedChanges && (
                  <Button variant="outline" size="sm" className="mt-3 w-full" onClick={discardChanges} disabled={pending}>
                    {t("discardChanges")}
                  </Button>
                )}
              </Panel>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <AiDialog open={aiOpen} onOpenChange={setAiOpen} replacing={fieldCount(schema) > 0} onDraft={applyAi} />

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{issues.length ? t("publishBlocked") : t("publishTitle", { version: (versions[0]?.version ?? 0) + 1 })}</DialogTitle>
            <DialogDescription>{issues.length ? t("publishBlockedBody") : t("publishBody")}</DialogDescription>
          </DialogHeader>
          {issues.length ? (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto" data-testid="publish-issues">
              {issues.map((i, n) => (
                <li key={n}>
                  <button type="button" onClick={() => goToIssue(i)} className="flex w-full items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft/50 px-3 py-2 text-start text-sm hover:bg-warning-soft">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    {issueText(i)}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3 text-sm">
              {services.length > 0 ? (
                <div>
                  <p className="mb-1.5 font-medium">{t("publishServices")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((s) => (
                      <Pill key={s.id} tone="brand">
                        {s.name}
                      </Pill>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">{t("publishNoServices")}</p>
              )}
              <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-muted-foreground">
                <FileCheck2 className="mt-0.5 size-4 shrink-0" />
                {t("publishKeepsSubmissions", { count: versions.reduce((s, v) => s + v.submissions, 0) })}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {t("cancel")}
            </Button>
            {!issues.length && (
              <Button onClick={publish} disabled={pending} data-testid="publish-confirm">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                {t("publishNow")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function dropUndef<T extends object>(o: T): T {
  const out = { ...o };
  for (const k of Object.keys(out) as Array<keyof T>) if (out[k] === undefined) delete out[k];
  return out;
}

function TypeIcon({ type, className }: { type: FieldType; className?: string }) {
  const I = TYPE_ICON[type] ?? Type;
  return <I className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />;
}

function PaletteItem({ type, label, addLabel, onAdd }: { type: FieldType; label: string; addLabel: string; onAdd: () => void }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `${PALETTE_ID}${type}` });
  // Pointer users drag the whole tile; keyboard and screen reader users press it to add the field.
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onAdd}
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler<HTMLButtonElement> | undefined}
      aria-roledescription={attributes["aria-roledescription"]}
      aria-describedby={attributes["aria-describedby"]}
      aria-label={addLabel}
      className={cn("group flex touch-none items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-start text-sm transition hover:border-border hover:bg-muted/60", isDragging && "opacity-50")}
      data-testid={`palette-${type}`}
    >
      <TypeIcon type={type} />
      <span className="flex-1 truncate">{label}</span>
      <Plus className="size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

function SectionCard({
  section,
  index,
  selected,
  selectedField,
  dragging,
  onSelect,
  onSelectField,
}: {
  section: FormSection;
  index: number;
  selected: boolean;
  selectedField: string | null;
  dragging: boolean;
  onSelect: () => void;
  onSelectField: (id: string) => void;
}) {
  const t = useTranslations("adminForms");
  const locale = useLocale();
  const { setNodeRef, isOver } = useDroppable({ id: `${SECTION}${section.id}` });
  return (
    <section ref={setNodeRef} className={cn("rounded-xl border bg-card p-3 shadow-xs transition", selected && "ring-2 ring-brand/40", isOver && "border-brand bg-brand-soft/30")} data-testid="builder-section">
      <button type="button" onClick={onSelect} className="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-start hover:bg-muted/50" data-testid={`section-head-${index}`}>
        <Layers className="size-4 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-semibold">{section.title ? tx(locale, section.title) : t("sectionN", { n: index + 1 })}</span>
        {section.showIf && (
          <Pill tone="violet">
            <GitBranch className="size-3" />
            {t("conditional")}
          </Pill>
        )}
      </button>
      <SortableContext items={section.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1.5" data-testid="section-fields">
          {section.fields.map((f) => (
            <FieldCard key={f.id} field={f} selected={selectedField === f.id} onSelect={() => onSelectField(f.id)} />
          ))}
        </ul>
      </SortableContext>
      {section.fields.length === 0 && (
        <div className={cn("grid place-items-center rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground", dragging && "border-brand/50 bg-brand-soft/20")} data-testid="section-empty">
          {t("dropHere")}
        </div>
      )}
    </section>
  );
}

function FieldCard({ field: f, selected, onSelect }: { field: FormField; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("adminForms");
  const locale = useLocale();
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: f.id });
  const label = tx(locale, f.label) || f.id;
  const refs = conditionRefs(f.showIf);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-stretch rounded-lg border bg-background transition", selected ? "border-brand ring-2 ring-brand/25" : "hover:border-foreground/20", isDragging && "opacity-40", f.width === "half" && "sm:me-[25%]")}
      data-testid="builder-field"
      data-field-id={f.id}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t("dragHandle", { field: label })}
            className="flex touch-none cursor-grab items-center rounded-s-lg border-e px-1.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
            data-testid="drag-handle"
          >
            <GripVertical className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("dragHint")}</TooltipContent>
      </Tooltip>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-start" aria-pressed={selected}>
        <TypeIcon type={f.type} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {label}
            {f.required && <span className="ms-0.5 text-danger">*</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {t(`types.${f.type}`)}
            {f.options?.length ? ` · ${t("optionsN", { count: f.options.length })}` : ""}
          </span>
        </span>
        {f.prefill && <Pill tone="info">{t("prefilled")}</Pill>}
        {refs.length > 0 && (
          <Pill tone="violet">
            <GitBranch className="size-3" />
            {t("conditional")}
          </Pill>
        )}
      </button>
    </li>
  );
}

function AiDialog({
  open,
  onOpenChange,
  replacing,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  replacing: boolean;
  onDraft: (draft: { name: { en: string; ar: string }; description: { en: string; ar: string }; schema: FormSchema }, interactionId: string, provider: string) => void;
}) {
  const t = useTranslations("adminForms");
  const [prompt, setPrompt] = useState("");
  const [pending, start] = useTransition();
  const examples = [t("aiExample1"), t("aiExample2"), t("aiExample3")];
  const run = () =>
    start(async () => {
      const res = await draftFormWithAiAction({ prompt });
      if (!res.ok) return void toast.error(t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t("errors.generic"));
      onDraft(res.draft, res.interactionId, res.provider);
      onOpenChange(false);
      setPrompt("");
      toast.success(t("aiReady"));
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-violet-600" />
            {t("aiTitle")}
          </DialogTitle>
          <DialogDescription>{t("aiBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder={t("aiPlaceholder")} aria-label={t("aiTitle")} data-testid="ai-prompt" />
          <div className="flex flex-wrap gap-1.5">
            {examples.map((ex) => (
              <button key={ex} type="button" onClick={() => setPrompt(ex)} className="rounded-full border bg-card px-2.5 py-1 text-start text-xs hover:bg-muted">
                {ex}
              </button>
            ))}
          </div>
          {replacing && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {t("aiReplaces")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={run} disabled={pending || prompt.trim().length < 8} data-testid="ai-generate">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {pending ? t("aiWorking") : t("aiGenerate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
