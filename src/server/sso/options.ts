// What a sign-in page offers. A school page shows only the options the school switched on and the server has
// credentials for (ClassLink and Clever also need the school's tenant or district id). The general page keeps the
// original behaviour: password, plus Google and Microsoft when this server has them.
import "server-only";
import { loadPolicy, methodAvailable } from "./policy";
import { methodConfigured } from "./providers";
import type { SsoButton } from "@/components/sso/sign-in-panel";

export type PageOptions = { sso: SsoButton[]; password: boolean; magicLink: boolean };

const ORDER: SsoButton["method"][] = ["classlink", "clever", "microsoft", "google", "oidc", "uaepass"];

export async function schoolSignInOptions(orgId: string): Promise<PageOptions> {
  const p = await loadPolicy(orgId);
  const sso: SsoButton[] = [];
  for (const m of ORDER) {
    if (!methodAvailable(p, m)) continue;
    if (m === "classlink" && !p.classlinkTenantId) continue;
    if (m === "clever" && !p.cleverDistrictId) continue;
    sso.push({ method: m, label: m === "oidc" ? p.oidcName : null });
  }
  return { sso, password: p.methods.includes("password"), magicLink: methodAvailable(p, "magic_link") };
}

export function generalSignInOptions(): PageOptions {
  const sso: SsoButton[] = [];
  if (methodConfigured("microsoft")) sso.push({ method: "microsoft" });
  if (methodConfigured("google")) sso.push({ method: "google" });
  return { sso, password: true, magicLink: methodConfigured("magic_link") };
}
