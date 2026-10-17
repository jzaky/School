"use client";
import { AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <Panel>
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-deny/10 text-deny">
            <AlertOctagon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-fg">Something went wrong</h1>
            <p className="mt-1 text-sm text-fg-muted">The page could not be rendered. The failure has been recorded with the reference below.</p>
            {error.digest ? <p className="mt-2 font-mono text-xs text-fg-dim">ref {error.digest}</p> : null}
            <div className="mt-4 flex gap-2">
              <Button variant="primary" onClick={reset}>
                Try again
              </Button>
              <Button variant="ghost" onClick={() => (window.location.href = "/overview")}>
                Back to Command Center
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
