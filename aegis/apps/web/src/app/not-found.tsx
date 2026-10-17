import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-panel border border-line bg-bg-elev p-6 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-lg border border-line bg-bg-elev-2 text-fg-dim">
          <FileQuestion className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="mt-3 text-base font-semibold text-fg">Page not found</h1>
        <p className="mt-1 text-sm text-fg-muted">The address does not match anything in this console, or the record belongs to another organization.</p>
        <Link href="/overview" className="mt-4 inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-strong">
          Back to Command Center
        </Link>
      </div>
    </main>
  );
}
