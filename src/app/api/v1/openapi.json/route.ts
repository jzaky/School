import { NextResponse } from "next/server";
import { openApiDocument } from "@/server/integrations/openapi";

export const runtime = "nodejs";

/** The OpenAPI 3 document for REST API v1. Public: it describes the API, it holds no school data. */
export function GET(req: Request) {
  const base = process.env.APP_URL || process.env.AUTH_URL || new URL(req.url).origin;
  return NextResponse.json(openApiDocument(base), { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
