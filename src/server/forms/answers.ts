import type { Ctx } from "@/server/context";
import { personName, pick, userName } from "@/lib/i18n-data";
import type { FormSchema } from "./schema";
import { fieldVisible } from "./logic";

export type Answer = { id: string; label: string; value: string; kind: "text" | "signature" | "long" };

/** Turn stored submission data into readable label and value pairs in the viewer's language. */
export async function formatAnswers(ctx: Ctx, schema: FormSchema, data: Record<string, unknown>): Promise<Answer[]> {
  const { db, orgId, locale } = ctx;
  const yes = locale === "ar" ? "نعم" : "Yes";
  const no = locale === "ar" ? "لا" : "No";
  const fields = schema.steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields));
  const studentIds = fields.filter((f) => f.type === "student_picker").map((f) => data[f.id]).filter((v): v is string => typeof v === "string");
  const staffIds = fields.filter((f) => f.type === "staff_picker").map((f) => data[f.id]).filter((v): v is string => typeof v === "string");
  const [students, staff, subjects] = await Promise.all([
    studentIds.length ? db.student.findMany({ where: { orgId, id: { in: studentIds } } }) : [],
    staffIds.length ? db.membership.findMany({ where: { id: { in: staffIds } }, include: { user: true } }) : [],
    db.subject.findMany({ where: { orgId } }),
  ]);
  const out: Answer[] = [];
  for (const f of fields) {
    if (f.type === "statement") continue;
    if (!fieldVisible(f, data)) continue;
    const v = data[f.id];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const label = pick(locale, f.label.en, f.label.ar);
    const optLabel = (val: unknown) => {
      const o = f.options?.find((x) => x.value === String(val));
      return o ? pick(locale, o.label.en, o.label.ar) : String(val);
    };
    let value: string;
    let kind: Answer["kind"] = "text";
    switch (f.type) {
      case "select":
      case "radio":
        value = optLabel(v);
        break;
      case "multi_select":
        value = (Array.isArray(v) ? v : [v]).map(optLabel).join(", ");
        break;
      case "checkbox":
        value = Array.isArray(v) ? v.map(optLabel).join(", ") : v === true ? yes : no;
        break;
      case "yes_no":
      case "consent":
        value = v === true ? yes : no;
        break;
      case "student_picker": {
        const s = students.find((x) => x.id === v);
        value = s ? personName(s, locale) : "";
        break;
      }
      case "staff_picker": {
        const m = staff.find((x) => x.id === v);
        value = m ? userName(m.user, locale) : "";
        break;
      }
      case "subject_picker": {
        const s = subjects.find((x) => x.code === v || x.id === v);
        value = s ? pick(locale, s.nameEn, s.nameAr) : String(v);
        break;
      }
      case "signature":
        value = String(v);
        kind = "signature";
        break;
      case "file":
        value = (v as { name?: string }).name ?? "";
        break;
      case "long_text":
        value = String(v);
        kind = "long";
        break;
      default:
        value = String(v);
    }
    if (value) out.push({ id: f.id, label, value, kind });
  }
  return out;
}
