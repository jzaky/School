import { getTranslations } from "next-intl/server";

export async function Logo({ inverted = false }: { inverted?: boolean }) {
  const t = await getTranslations("meta");
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-[#123A63] to-[#1d5a93] text-sm font-bold text-[#E9C46A] shadow-sm">H</span>
      <span className={inverted ? "text-base font-semibold text-white" : "text-base font-semibold"}>{t("appTitle")}</span>
    </span>
  );
}
