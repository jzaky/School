import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { JoinLocaleToggle } from "./join-frame";

/** Mobile-first frame for the public join pages. */
export function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="mx-auto flex w-full max-w-lg items-center justify-between px-4 py-4">
        <Link href="/">
          <Logo />
        </Link>
        <JoinLocaleToggle />
      </header>
      <main className="mx-auto w-full max-w-lg px-4 pb-12">{children}</main>
    </div>
  );
}
