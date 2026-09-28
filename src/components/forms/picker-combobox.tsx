"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export type PickerOption = { value: string; label: string; hint?: string; keywords?: string };

/** Searchable single-select. Matches English and Arabic names through keywords. */
export function PickerCombobox({
  id,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  testId,
}: {
  id?: string;
  options: PickerOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-start text-sm shadow-xs transition disabled:cursor-not-allowed disabled:bg-muted/60",
            !selected && "text-muted-foreground",
          )}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
            {selected?.hint && <span className="ms-2 text-xs text-muted-foreground">{selected.hint}</span>}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command filter={(v, search, keywords) => ((v + " " + (keywords ?? []).join(" ")).toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder={t("search")} />
          <CommandList>
            <CommandEmpty>{t("noResults")}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  keywords={o.keywords ? [o.keywords] : undefined}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
