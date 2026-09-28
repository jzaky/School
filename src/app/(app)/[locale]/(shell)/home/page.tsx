import { getCtx } from "@/server/context";
import { userName } from "@/lib/i18n-data";

export default async function HomePage() {
  const ctx = await getCtx();
  return <div className="p-8 text-2xl font-semibold">{userName(ctx.user, ctx.locale)}</div>;
}
