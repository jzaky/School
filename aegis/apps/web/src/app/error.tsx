"use client";
import { ErrorView } from "@/components/error-view";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen bg-bg p-6 text-fg">
      <ErrorView error={error} reset={reset} />
    </main>
  );
}
