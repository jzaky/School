"use client";

import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children, dir }: { children: React.ReactNode; dir: "ltr" | "rtl" }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} dir={dir} richColors closeButton />
      </TooltipProvider>
    </MotionConfig>
  );
}
