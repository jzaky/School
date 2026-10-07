import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { tenantDb, userScope } from "@/lib/tenant-db";
import { readLocal, signedUrl } from "@/server/documents/storage";
import { catalogDb } from "@/server/platform/catalog-db";
import { platformAdminById } from "@/server/groups/access";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** A school group's logo, for its members, its schools' people and platform admins. */
export async function GET(_: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !groupId) return new NextResponse(null, { status: 404 });
  const select = { logoUrl: true } as const;
  let group = await userScope(userId, (tx) => tx.schoolGroup.findUnique({ where: { id: groupId }, select }));
  if (!group && session.user.activeOrgId) group = await tenantDb(session.user.activeOrgId).schoolGroup.findUnique({ where: { id: groupId }, select });
  if (!group && (await platformAdminById(userId))) group = (await catalogDb()?.schoolGroup.findUnique({ where: { id: groupId }, select })) ?? null;
  const key = group?.logoUrl;
  if (!key) return new NextResponse(null, { status: 404 });
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext];
  if (!type) return new NextResponse(null, { status: 404 });
  const url = await signedUrl(key, `group-logo.${ext}`);
  if (url) return NextResponse.redirect(url);
  const bytes = await readLocal(key);
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
