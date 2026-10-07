/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

/** The group's logo (served with an access check by /api/group/logo/[id]) or its initial. */
export function GroupMark({ groupId, name, hasLogo, version, className }: { groupId: string; name: string; hasLogo: boolean; version?: number; className?: string }) {
  if (hasLogo) {
    return <img src={`/api/group/logo/${groupId}?v=${version ?? 0}`} alt={name} className={cn("size-12 shrink-0 rounded-xl border bg-card object-contain p-1", className)} data-testid="group-logo" />;
  }
  return (
    <div className={cn("grid size-12 shrink-0 place-items-center rounded-xl bg-brand text-lg font-semibold text-brand-foreground", className)} aria-hidden data-testid="group-initial">
      {name.trim().charAt(0)}
    </div>
  );
}
