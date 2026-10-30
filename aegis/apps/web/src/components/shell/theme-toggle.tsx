"use client";
import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { useT } from "@/components/region-provider";
import { applyChoice, readChoice, type ThemeChoice } from "@/lib/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = { dark: "light", light: "system", system: "dark" };

export function ThemeToggle() {
  const { t } = useT();
  const [choice, setChoice] = React.useState<ThemeChoice>("dark");
  React.useEffect(() => setChoice(readChoice()), []);
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <IconButton
      label={t(`shell.theme.${choice}`)}
      data-testid="theme-toggle"
      data-theme-choice={choice}
      onClick={() => {
        const next = NEXT[choice];
        applyChoice(next);
        setChoice(next);
      }}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </IconButton>
  );
}
