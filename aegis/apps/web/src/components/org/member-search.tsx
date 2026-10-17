"use client";
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function MemberSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState(initial);
  return (
    <form
      role="search"
      className="relative w-64"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
      }}
    >
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-dim" aria-hidden />
      <Input aria-label="Search members" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} className="ps-8" />
    </form>
  );
}
