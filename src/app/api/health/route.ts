import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness of the web app for the status job. Says nothing about the server, its version or its host. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
