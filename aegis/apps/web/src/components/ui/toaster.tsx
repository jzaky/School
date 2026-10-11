"use client";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!bg-bg-elev-2 !border !border-line-strong !text-fg !shadow-xl !rounded-md !text-sm",
          description: "!text-fg-muted",
          actionButton: "!bg-accent !text-white",
          cancelButton: "!bg-bg-elev !text-fg",
        },
      }}
    />
  );
}
