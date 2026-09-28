import type { Ctx } from "@/server/context";
import { visibleStudentIds } from "./student-access";

type Doc = { id: string; studentId: string | null; caseId: string | null; requestId: string | null; sensitivity: string; visibleToFamily: boolean; uploadedById: string };

/** Whether the member may open a document. Sensitive categories need explicit permissions. */
export async function canOpenDocument(ctx: Ctx, d: Doc): Promise<boolean> {
  if (!ctx.isStaff) {
    if (!d.visibleToFamily || !d.studentId) return false;
    const ids = await visibleStudentIds(ctx);
    return ids !== null && ids.includes(d.studentId);
  }
  if (d.uploadedById === ctx.membershipId) return true;
  switch (d.sensitivity) {
    case "SAFEGUARDING":
      return ctx.can("safeguarding.view");
    case "WELLBEING":
      return ctx.can("cases.wellbeing") || ctx.can("documents.sensitive");
    case "MEDICAL":
      return ctx.can("people.medical") || ctx.can("documents.sensitive");
    case "CONFIDENTIAL":
      return ctx.can("documents.sensitive") || ctx.can("documents.manage") || ctx.can("people.reveal_ids");
    default:
      return ctx.can("documents.view");
  }
}
