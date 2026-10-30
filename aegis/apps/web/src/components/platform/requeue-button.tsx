"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { requeueJobAction } from "@/server/actions/platform";
import { Button } from "@/components/ui/button";

export function RequeueButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={async () => {
        setPending(true);
        const r = await requeueJobAction(jobId);
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Job requeued");
        router.refresh();
      }}
    >
      Requeue
    </Button>
  );
}
