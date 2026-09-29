import "server-only";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/context";
import { moduleEnabled, type ModuleKey } from "@/lib/modules";

/** Use at the top of a module's layout or route: a switched-off module answers 404, like a page that does not exist. */
export async function requireModule(key: ModuleKey) {
  const ctx = await getCtx();
  if (!moduleEnabled(ctx.org, key)) notFound();
  return ctx;
}
