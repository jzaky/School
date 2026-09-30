import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { ensureJoinCode } from "@/server/access/invitations";
import { bothLanguages } from "@/server/access/email-text";
import { renderJoinPoster } from "@/server/access/poster";
import { loadLogo } from "@/server/documents/letterhead";

export const runtime = "nodejs";

/** Printable family join poster (PDF) with the school code and a QR code. Inviters only. */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.can("people.invite")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const code = await ensureJoinCode(ctx.orgId);
  const base = (process.env.APP_URL || new URL(req.url).origin).replace(/\/+$/, "");
  const url = `${base}/join?code=${encodeURIComponent(code)}`;
  const t = (k: string, vars: Record<string, string> = {}) => bothLanguages("accessPoster", k, vars);
  const steps = [t("step1", { url: `${base}/join` }), t("step2"), t("step3")];
  const pdf = await renderJoinPoster({
    school: { en: ctx.org.nameEn, ar: ctx.org.nameAr },
    code,
    url,
    title: t("title"),
    subtitle: t("subtitle"),
    codeLabel: t("codeLabel"),
    footer: ctx.org.parentJoinApproval ? t("footerApproval") : t("footerInstant"),
    steps: { en: steps.map((s) => s.en), ar: steps.map((s) => s.ar) },
    color: ctx.org.primaryColor,
    logo: await loadLogo(ctx.org.logoUrl),
  });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "join.poster_download", entityType: "Organization", entityId: ctx.orgId });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="join-poster-${code}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
