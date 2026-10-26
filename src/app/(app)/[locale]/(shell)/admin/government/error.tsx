"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { PageBody } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

export default function GovernmentError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("govReports");
  return (
    <PageBody>
      <EmptyState
        icon={<AlertTriangle className="size-5" />}
        title={t("errorTitle")}
        body={t("errorBody")}
        action={
          <Button variant="outline" onClick={reset}>
            {t("retry")}
          </Button>
        }
      />
    </PageBody>
  );
}
