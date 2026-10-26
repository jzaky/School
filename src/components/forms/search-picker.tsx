"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { searchGuardiansAction, searchStudentsAction, type PickHit, type StudentSearch } from "@/server/people/search-actions";

/**
 * Searchable single-select that asks the server as the person types, so it works the same for 50 or 5,000 people.
 * Shows the first matches when opened. `selected` is the current choice (for a value set before the picker opens).
 */
export function SearchPicker({
  id,
  search,
  value,
  selected,
  onChange,
  placeholder,
  disabled,
  testId,
}: {
  id?: string;
  search: (q: string) => Promise<PickHit[]>;
  value: string;
  selected?: PickHit | null;
  onChange: (v: string, hit: PickHit | null) => void;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const t = useTranslations("common");
  const tp = useTranslations("paging");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<PickHit | null>(selected ?? null);
  const seq = useRef(0);

  useEffect(() => {
    if (selected && selected.value === value) setChosen(selected);
    if (!value) setChosen(null);
  }, [selected, value]);

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    setLoading(true);
    setFailed(false);
    const h = setTimeout(
      () => {
        search(q)
          .then((rows) => mine === seq.current && setHits(rows))
          .catch(() => mine === seq.current && setFailed(true))
          .finally(() => mine === seq.current && setLoading(false));
      },
      q ? 250 : 0,
    );
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  const current = chosen && chosen.value === value ? chosen : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          data-testid={testId}
          className={cn("flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-start text-sm shadow-xs transition disabled:cursor-not-allowed disabled:bg-muted/60", !current && "text-muted-foreground")}
        >
          <span className="truncate">
            {current ? current.label : placeholder}
            {current?.hint && <span className="ms-2 text-xs text-muted-foreground">{current.hint}</span>}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("search")} value={q} onValueChange={setQ} data-testid={testId ? `${testId}-search` : undefined} />
          <CommandList>
            {loading && hits.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {tp("searching")}
              </div>
            ) : failed ? (
              <div className="px-3 py-4 text-sm text-danger">{tp("searchFailed")}</div>
            ) : (
              <CommandEmpty>{t("noResults")}</CommandEmpty>
            )}
            <CommandGroup>
              {hits.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={() => {
                    setChosen(o);
                    onChange(o.value, o);
                    setOpen(false);
                  }}
                  data-testid={testId ? `${testId}-option` : undefined}
                >
                  <Check className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
            {hits.length >= 20 && <div className="border-t px-3 py-2 text-xs text-muted-foreground">{tp("typeToNarrow")}</div>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Student picker backed by server search. */
export function StudentSearchPicker({ filters, ...rest }: Omit<Parameters<typeof SearchPicker>[0], "search"> & { filters?: Omit<StudentSearch, "q"> }) {
  return <SearchPicker {...rest} search={(q) => searchStudentsAction({ ...filters, q })} />;
}

/** Guardian picker backed by server search. */
export function GuardianSearchPicker(props: Omit<Parameters<typeof SearchPicker>[0], "search">) {
  return <SearchPicker {...props} search={(q) => searchGuardiansAction({ q })} />;
}
