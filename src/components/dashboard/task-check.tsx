"use client";

import { useOptimistic, useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { setTaskStatusAction } from "@/server/tasks/actions";

export function TaskCheck({ id, done, label }: { id: string; done: boolean; label: string }) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={optimistic}
      aria-label={label}
      data-testid="task-check"
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          await setTaskStatusAction(id, optimistic ? "TODO" : "DONE");
        })
      }
      className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2 transition", optimistic ? "border-success bg-success text-white" : "border-muted-foreground/40 hover:border-brand")}
    >
      {optimistic && <Check className="size-3" />}
    </button>
  );
}
