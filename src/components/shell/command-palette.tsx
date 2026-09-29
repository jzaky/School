"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, FileText, FolderKanban, GraduationCap, Landmark, LayoutGrid, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Icon } from "@/components/icon";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { searchAction, type SearchHit } from "@/server/search/actions";
import type { NavSection } from "@/server/shell/nav";

const KIND_ICON = { student: GraduationCap, request: FileText, case: FolderKanban, service: LayoutGrid, university: Landmark, program: BookOpen } as const;

export function CommandPalette({ open, onOpenChange, nav }: { open: boolean; onOpenChange: (o: boolean) => void; nav: NavSection[] }) {
  const t = useTranslations("shell");
  const tn = useTranslations("nav");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => setHits(await searchAction(query)));
    }, 180);
    return () => clearTimeout(handle);
  }, [query]);

  const go = (href: string) => {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  };

  const groups: Array<{ kind: SearchHit["kind"]; label: string }> = [
    { kind: "student", label: t("groupStudents") },
    { kind: "request", label: t("groupRequests") },
    { kind: "case", label: t("groupCases") },
    { kind: "service", label: t("groupServices") },
    { kind: "university", label: t("groupUniversities") },
    { kind: "program", label: t("groupPrograms") },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t("search")} description={t("commandPlaceholder")} shouldFilter={false}>
      <CommandInput placeholder={t("commandPlaceholder")} value={query} onValueChange={setQuery} data-testid="palette-input" />
      <CommandList>
        <CommandEmpty>{pending ? <Loader2 className="mx-auto size-4 animate-spin" /> : t("commandEmpty")}</CommandEmpty>
        {groups.map((g) => {
          const items = hits.filter((h) => h.kind === g.kind);
          if (!items.length) return null;
          const KindIcon = KIND_ICON[g.kind];
          return (
            <CommandGroup key={g.kind} heading={g.label}>
              {items.map((h) => (
                <CommandItem key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}`} onSelect={() => go(h.href)} data-testid={`palette-${h.kind}`}>
                  <KindIcon className="size-4 text-muted-foreground" />
                  <span className="font-medium">{h.title}</span>
                  {h.subtitle && <span className="truncate text-muted-foreground">{h.subtitle}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {query.trim().length < 2 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("groupNavigate")}>
              {nav.flatMap((s) => s.items).map((item) => (
                <CommandItem key={item.key} value={`nav-${item.key}`} onSelect={() => go(item.href)}>
                  <Icon name={item.icon} className="size-4 text-muted-foreground" />
                  {tn(item.key)}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
