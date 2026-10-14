"use client";
import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { applyChoice, readChoice, type ThemeChoice } from "@/lib/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = { dark: "light", light: "system", system: "dark" };
const LABEL: Record<ThemeChoice, string> = { dark: "Theme: dark (switch to light)", light: "Theme: light (switch to follow the system)", system: "Theme: follows the system (switch to dark)" };

export function ThemeToggle() {
  const [choice, setChoice] = React.useState<ThemeChoice>("dark");
  React.useEffect(() => setChoice(readChoice()), []);
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <IconButton
      label={LABEL[choice]}
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
