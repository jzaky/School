"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-accent text-white hover:bg-accent-strong",
        secondary: "border-line-strong bg-bg-elev text-fg hover:bg-bg-elev-2",
        ghost: "border-transparent bg-transparent text-fg-muted hover:bg-bg-elev-2 hover:text-fg",
        danger: "border-transparent bg-deny text-white hover:bg-deny/85",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3",
        lg: "h-10 px-4 text-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  /** When the button is disabled, explain why. Rendered as a tooltip. */
  disabledReason?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, loading, disabled, disabledReason, children, type = "button", ...props }, ref) {
  const isDisabled = disabled || loading;
  const btn = (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={isDisabled} aria-disabled={isDisabled || undefined} {...props}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
  if (isDisabled && disabledReason) {
    return (
      <Tooltip content={disabledReason}>
        <span className="inline-flex" tabIndex={0}>
          {btn}
        </span>
      </Tooltip>
    );
  }
  return btn;
});

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  label: string;
  children: React.ReactNode;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, className, size = "md", variant = "ghost", children, disabledReason, disabled, ...props }, ref) {
  const btn = (
    <Button ref={ref} aria-label={label} title={disabled && disabledReason ? undefined : label} variant={variant} size={size} disabled={disabled} className={cn("px-0", size === "sm" ? "w-7" : size === "lg" ? "w-10" : "w-8", className)} {...props}>
      {children}
    </Button>
  );
  if (disabled && disabledReason) {
    return (
      <Tooltip content={disabledReason}>
        <span className="inline-flex" tabIndex={0}>
          {btn}
        </span>
      </Tooltip>
    );
  }
  return btn;
});
