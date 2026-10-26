"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copy the school's public application link (for the website, social media or an email to families). */
export function CopyLink({ path, label }: { path: string; label: string }) {
  const t = useTranslations("admissions.board");
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const url = `${window.location.origin}${path}`;
        try {
          await navigator.clipboard.writeText(url);
          toast.success(t("copied"));
        } catch {
          toast.message(url);
        }
      }}
      data-testid="copy-apply-link"
    >
      <Link2 className="size-4" />
      {label}
    </Button>
  );
}
