import { NextResponse } from "next/server";
import { SAMPLE_FILES } from "@/lib/integrations/samples";

export const runtime = "nodejs";

/** Sample export files (fictional people) for trying scheduled sync. Public: no school data. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const make = Object.prototype.hasOwnProperty.call(SAMPLE_FILES, file) ? SAMPLE_FILES[file] : null;
  if (!make) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown sample file." } }, { status: 404 });
  return new NextResponse(`﻿${make()}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
