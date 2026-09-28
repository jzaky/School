import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-4 px-4 py-5 sm:px-6 lg:px-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-72" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)_360px]">
        <Skeleton className="h-40 rounded-xl lg:h-[calc(100vh-16rem)]" />
        <Skeleton className="h-[62vh] rounded-xl lg:h-[calc(100vh-16rem)]" />
        <Skeleton className="h-64 rounded-xl lg:h-[calc(100vh-16rem)]" />
      </div>
    </div>
  );
}
