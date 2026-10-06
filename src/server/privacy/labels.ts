// Bilingual labels for generated export files (PDF summary, README). Read straight from the next-intl
// message files so the same text serves request code, tests and the worker.
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";

type Tree = { [k: string]: string | Tree };

function lookup(tree: Tree, key: string): string | null {
  let cur: string | Tree | undefined = tree;
  for (const part of key.split(".")) {
    if (!cur || typeof cur === "string") return null;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : null;
}

function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** A message from the privacyExport namespace in one locale, with simple {var} substitution. */
export function exportLabel(locale: "en" | "ar", key: string, vars?: Record<string, string | number>): string {
  const tree = (locale === "ar" ? ar : en) as unknown as Tree;
  return fill(lookup(tree, `privacyExport.${key}`) ?? lookup(en as unknown as Tree, `privacyExport.${key}`) ?? key, vars);
}

/** Human label for a data area (a Prisma model name), falling back to the model name split into words. */
export function areaLabel(locale: "en" | "ar", model: string): string {
  const tree = (locale === "ar" ? ar : en) as unknown as Tree;
  return lookup(tree, `privacyExport.areas.${model}`) ?? model.replace(/([a-z])([A-Z])/g, "$1 $2");
}
