"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

export default function CatalogError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <EmptyState
      icon={<AlertTriangle className="size-5" />}
      title={t("somethingWrong")}
      body={t("somethingWrongBody")}
      action={
        <Button variant="outline" onClick={reset}>
          {t("retry")}
        </Button>
      }
    />
  );
}
