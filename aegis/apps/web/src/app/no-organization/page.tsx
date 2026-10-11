import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { listUserMemberships } from "@aegis/core";
import { requireUser } from "@/server/session";
import { logoutAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "No organization" };
export const dynamic = "force-dynamic";

export default async function NoOrganizationPage() {
  const s = await requireUser();
  const memberships = await listUserMemberships(s.user.id);
  if (memberships.some((m) => m.status === "active")) redirect("/overview");
  const suspended = memberships.filter((m) => m.status === "suspended");
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-panel border border-line bg-bg-elev p-6">
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-bg-elev-2 text-fg-dim">
          <Building2 className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="mt-3 text-base font-semibold text-fg">No organization yet</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {s.user.name}, your account ({s.user.email}) is not a member of any organization. Ask an administrator for an invitation link, then open it while signed in.
        </p>
        {suspended.length ? <p className="mt-2 text-xs text-approval">Your membership in {suspended.map((m) => m.orgName).join(", ")} is suspended. Contact the administrator of that organization.</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {s.user.isPlatformAdmin ? (
            <Link href="/platform/tenants" className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-strong">
              Open platform admin
            </Link>
          ) : null}
          <form action={logoutAction}>
            <button type="submit" className="inline-flex h-8 items-center rounded-md border border-line-strong bg-bg-elev px-3 text-sm text-fg transition-colors duration-150 hover:bg-bg-elev-2">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
