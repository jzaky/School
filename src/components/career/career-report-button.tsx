import { getTranslations } from "next-intl/server";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Downloads the bilingual career guidance report PDF (access checked and audited by the route). */
export async function CareerReportButton({ studentId, size = "sm" }: { studentId: string; size?: "sm" | "default" }) {
  const t = await getTranslations("careerReport");
  return (
    <Button asChild variant="outline" size={size}>
      <a href={`/api/career/report?student=${encodeURIComponent(studentId)}`} download data-testid="career-report-download">
        <FileDown className="size-4" />
        {t("download")}
      </a>
    </Button>
  );
}
