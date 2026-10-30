"use client";
import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type VisibilityState, type RowData } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "./button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "./dropdown-menu";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "start" | "end";
    width?: number | string;
    className?: string;
  }
}

export interface ServerPagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Server-side pagination: the table writes page and pageSize into the URL search params. */
  pagination?: ServerPagination;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string;
  emptyState?: React.ReactNode;
  loading?: boolean;
  toolbar?: React.ReactNode;
  columnVisibilityMenu?: boolean;
  storageKey?: string;
  className?: string;
  dense?: boolean;
  caption?: string;
}

export function DataTable<T>({ columns, data, pagination, getRowId, onRowClick, rowHref, emptyState, loading, toolbar, columnVisibilityMenu = true, storageKey, className, caption }: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => {
    if (!storageKey || typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(`aegis.table.${storageKey}`);
      return raw ? (JSON.parse(raw) as VisibilityState) : {};
    } catch {
      return {};
    }
  });
  React.useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(`aegis.table.${storageKey}`, JSON.stringify(columnVisibility));
    } catch {
      // storage unavailable
    }
  }, [columnVisibility, storageKey]);

  const table = useReactTable({
    data,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    manualPagination: true,
  });

  function setParam(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function navigate(row: T) {
    if (rowHref) router.push(rowHref(row));
    else onRowClick?.(row);
  }
  const interactive = Boolean(rowHref || onRowClick);
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const colCount = table.getVisibleLeafColumns().length;

  return (
    <div className={cn("flex flex-col", className)}>
      {toolbar || columnVisibilityMenu ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {columnVisibilityMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Choose columns">
                  <Columns3 className="h-3.5 w-3.5" aria-hidden />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                {table
                  .getAllLeafColumns()
                  .filter((c) => c.getCanHide())
                  .map((c) => (
                    <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                      {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
      <div className="relative overflow-auto rounded-panel border border-line bg-bg-elev">
        <table className="w-full border-collapse text-[13px]">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="sticky top-0 z-10 bg-bg-elev-2/95 backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta;
                  return (
                    <th key={h.id} scope="col" style={{ width: meta?.width }} className={cn("h-9 whitespace-nowrap border-b border-line px-3 text-start text-xs font-medium text-fg-muted", meta?.align === "end" && "text-end", meta?.className)}>
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`s-${i}`} className="border-b border-line last:border-b-0">
                    {Array.from({ length: colCount }).map((_, c) => (
                      <td key={c} className="h-9 px-3">
                        <Skeleton className="h-3 w-24" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.length === 0
                ? (
                    <tr>
                      <td colSpan={colCount}>{emptyState ?? <EmptyState title="No records" />}</td>
                    </tr>
                  )
                : table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={interactive ? 0 : undefined}
                      role={interactive ? "link" : undefined}
                      onClick={interactive ? (e) => {
                        if ((e.target as HTMLElement).closest("button, a, input, [role=menuitem], [data-no-row-click]")) return;
                        navigate(row.original);
                      } : undefined}
                      onKeyDown={interactive ? (e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(row.original);
                        }
                      } : undefined}
                      className={cn("border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-bg-elev-2/60 focus-visible:bg-bg-elev-2 focus-visible:outline-none", interactive && "cursor-pointer")}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta;
                        return (
                          <td key={cell.id} className={cn("h-9 max-w-[320px] truncate px-3 align-middle text-fg", meta?.align === "end" && "tabular text-end", meta?.className)}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>
      {pagination ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
          <div className="tabular">
            {pagination.total === 0 ? "0 records" : `${(pagination.page - 1) * pagination.pageSize + 1} to ${Math.min(pagination.total, pagination.page * pagination.pageSize)} of ${pagination.total}`}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span>Rows</span>
              <select aria-label="Rows per page" value={pagination.pageSize} onChange={(e) => setParam({ pageSize: e.target.value, page: "1" })} className="h-7 rounded-md border border-line bg-bg px-1.5 text-xs text-fg outline-none focus:border-accent">
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <IconButton label="Previous page" size="sm" disabled={pagination.page <= 1} onClick={() => setParam({ page: String(pagination.page - 1) })}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </IconButton>
            <span className="tabular">
              Page {pagination.page} of {pageCount}
            </span>
            <IconButton label="Next page" size="sm" disabled={pagination.page >= pageCount} onClick={() => setParam({ page: String(pagination.page + 1) })}>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
