import { redirect } from "next/navigation";
import { getCtx } from "@/server/context";

export default async function ChildrenIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ctx = await getCtx();
  const first = ctx.membership.guardian?.links[0]?.studentId;
  redirect(first ? `/${locale}/children/${first}` : `/${locale}/home`);
}
