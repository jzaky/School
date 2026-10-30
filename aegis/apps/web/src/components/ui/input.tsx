import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass = "h-8 w-full rounded-md border border-line bg-bg px-2.5 text-sm text-fg placeholder:text-fg-dim outline-none transition-colors duration-150 focus:border-accent disabled:cursor-not-allowed disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, type = "text", ...props }, ref) {
  return <input ref={ref} type={type} className={cn(inputClass, type === "number" && "tabular text-end", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function Textarea({ className, mono, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputClass, "h-auto min-h-[80px] py-2 leading-5", mono && "font-mono text-xs", className)} {...props} />;
});

export function Label({ className, children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: React.ReactNode }) {
  return (
    <label className={cn("mb-1 block text-xs font-medium text-fg-muted", className)} {...props}>
      {children}
      {hint ? <span className="ms-1 font-normal text-fg-dim">{hint}</span> : null}
    </label>
  );
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: React.ReactNode; htmlFor?: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-deny">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-deny/30 bg-deny/10 px-3 py-2 text-xs text-deny">
      {error}
    </p>
  );
}
