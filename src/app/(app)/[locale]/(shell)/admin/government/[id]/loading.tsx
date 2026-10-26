import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/components/app/page-header";

export default function Loading() {
  return (
    <PageBody className="max-w-6xl">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-72 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <Skeleton className="h-6 w-80" />
      <div className="space-y-2 rounded-xl border bg-card p-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
      <div className="space-y-2 rounded-xl border bg-card p-5">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </PageBody>
  );
}
