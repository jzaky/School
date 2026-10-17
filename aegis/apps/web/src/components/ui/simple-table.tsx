import * as React from "react";
import { cn } from "@/lib/utils";

/** Static table with the console's table styling, for server-rendered lists that need no pagination. */
export function SimpleTable({ children, className, caption }: { children: React.ReactNode; className?: string; caption?: string }) {
  return (
    <div className={cn("overflow-auto rounded-panel border border-line bg-bg-elev", className)}>
      <table className="w-full border-collapse text-[13px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = "start", className, ...props }: Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "align"> & { align?: "start" | "end" }) {
  return (
    <th scope="col" className={cn("h-9 whitespace-nowrap border-b border-line bg-bg-elev-2/95 px-3 text-xs font-medium text-fg-muted", align === "end" ? "text-end" : "text-start", className)} {...props}>
      {children}
    </th>
  );
}

export function Td({ children, align = "start", mono, className, ...props }: Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "align"> & { align?: "start" | "end"; mono?: boolean }) {
  return (
    <td className={cn("h-9 px-3 align-middle text-fg", align === "end" && "tabular text-end", mono && "font-mono text-xs", className)} {...props}>
      {children}
    </td>
  );
}

export function Tr({ children, className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-bg-elev-2/60", className)} {...props}>
      {children}
    </tr>
  );
}
