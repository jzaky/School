import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/components/app/page-header";

export default function Loading() {
  return (
    <PageBody className="max-w-6xl">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[84px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-sm" />
      <div className="space-y-2 rounded-xl border bg-card p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </PageBody>
  );
}
