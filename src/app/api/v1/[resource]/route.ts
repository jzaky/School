// REST API v1: GET lists and POST upserts for students (with guardians), staff, classes, enrollments and
// attendance. Authenticated with a school API key (Bearer). See /api/v1/openapi.json.
import { NextResponse } from "next/server";
import { API_RESOURCES, allows, isApiResource, type ApiResource } from "@/lib/integrations/scopes";
import { keyFromHeaders } from "@/server/integrations/key-format";
import { authenticateApiKey } from "@/server/integrations/keys";
import { API_ERROR_MESSAGES, ApiError, listAttendance, listClasses, listEnrollments, listStaff, listStudents, upsert, upsertAttendance, type ApiErrorCode } from "@/server/integrations/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function errorResponse(status: number, code: ApiErrorCode, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, message: API_ERROR_MESSAGES[code] } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function describe(err: unknown) {
  // Error messages can carry query values, so only the class and code are logged.
  const e = err as { name?: string; code?: string } | null;
  return `${e?.name ?? "Error"}${e?.code ? ` code=${e.code}` : ""}`;
}

async function handle(req: Request, params: Promise<{ resource: string }>, method: "GET" | "POST") {
  const { resource } = await params;
  if (!isApiResource(resource)) return errorResponse(404, "NOT_FOUND");
  const auth = await authenticateApiKey(keyFromHeaders(req.headers));
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.retryAfterSec ? { "Retry-After": String(auth.retryAfterSec) } : {});
  const area = API_RESOURCES[resource as ApiResource];
  if (!allows(auth.scopes, area, method === "GET" ? "read" : "write")) return errorResponse(403, "FORBIDDEN_SCOPE");
  try {
    if (method === "GET") {
      const sp = new URL(req.url).searchParams;
      const page =
        resource === "students"
          ? await listStudents(auth.orgId, sp)
          : resource === "staff"
            ? await listStaff(auth.orgId, sp)
            : resource === "classes"
              ? await listClasses(auth.orgId, sp)
              : resource === "enrollments"
                ? await listEnrollments(auth.orgId, sp)
                : await listAttendance(auth.orgId, sp);
      return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
    }
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_BODY_BYTES) return errorResponse(413, "TOO_LARGE");
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return errorResponse(413, "TOO_LARGE");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return errorResponse(400, "INVALID_BODY");
    }
    const source = `API ${auth.prefix}`;
    const result = resource === "attendance" ? await upsertAttendance(auth.actor, body, source) : await upsert(resource, auth.actor, body, source);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.status, err.code);
    console.error(`[api/v1] ${method} ${resource} failed: ${describe(err)}`);
    return errorResponse(500, "INTERNAL");
  }
}

export function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  return handle(req, params, "GET");
}

export function POST(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  return handle(req, params, "POST");
}

const notAllowed = () => errorResponse(405, "METHOD_NOT_ALLOWED", { Allow: "GET, POST" });
export { notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
