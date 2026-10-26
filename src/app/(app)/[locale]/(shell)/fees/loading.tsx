import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/components/app/page-header";

export default function Loading() {
  return (
    <PageBody>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[84px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="space-y-2 rounded-xl border bg-card p-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </PageBody>
  );
}
