import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const base = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-medium transition-colors duration-150 ease-out select-none";
const variants = {
  primary: "border-transparent bg-accent text-white hover:bg-accent-strong",
  secondary: "border-line-strong bg-bg-elev text-fg hover:bg-bg-elev-2",
  ghost: "border-transparent bg-transparent text-fg-muted hover:bg-bg-elev-2 hover:text-fg",
};
const sizes = { sm: "h-7 px-2.5 text-xs", md: "h-8 px-3", lg: "h-10 px-4 text-sm" };

/** A link that looks like a Button. Server-component safe. */
export function LinkButton({ href, variant = "secondary", size = "md", className, children, ...props }: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string; variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return (
    <Link href={href} className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </Link>
  );
}
