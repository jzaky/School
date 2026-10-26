// Sign-in option marks. Google and Microsoft use their published logo shapes and colors; ClassLink, Clever and
// UAE PASS use simple marks in their brand colors (replace with the official artwork from each provider's brand
// kit when the partnership is signed; see docs/guides/sign-in.md). All are decorative (aria-hidden).
import { Building2, Fingerprint, KeyRound, Mail } from "lucide-react";
import type { SignInMethod } from "@/server/sso/providers";
import { cn } from "@/lib/utils";

export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 23 23" className={className} aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function ClassLinkMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#0F67B1" />
      <path d="M15.6 8.2a5 5 0 1 0 0 7.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="17.2" cy="12" r="1.7" fill="#7CC243" />
    </svg>
  );
}

export function CleverMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#4274F6" />
      <path d="M16.4 8.6A5.2 5.2 0 0 0 7 12a5.2 5.2 0 0 0 9.4 3.4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function UaePassMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-grid place-items-center rounded-md bg-[#1D1D1B] text-white", className)} aria-hidden="true">
      <Fingerprint className="size-[70%]" />
    </span>
  );
}

export function MethodMark({ method, className = "size-5" }: { method: SignInMethod; className?: string }) {
  switch (method) {
    case "google":
      return <GoogleMark className={className} />;
    case "microsoft":
      return <MicrosoftMark className={className} />;
    case "classlink":
      return <ClassLinkMark className={className} />;
    case "clever":
      return <CleverMark className={className} />;
    case "uaepass":
      return <UaePassMark className={className} />;
    case "oidc":
      return <Building2 className={cn(className, "text-brand")} aria-hidden="true" />;
    case "magic_link":
      return <Mail className={cn(className, "text-brand")} aria-hidden="true" />;
    case "password":
      return <KeyRound className={cn(className, "text-brand")} aria-hidden="true" />;
    default:
      return <span className={cn(className, "inline-block rounded-md bg-muted")} aria-hidden="true" />;
  }
}
