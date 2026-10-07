// OpenAPI 3 description of REST API v1, built from the Import center column definitions so the documented
// fields can never drift from what the import accepts. Served at /api/v1/openapi.json.
import { STUDENT_COLUMNS } from "@/lib/people-csv";
import { STAFF_COLUMNS } from "@/lib/imports/staff";
import { CLASS_COLUMNS, ENROLLMENT_COLUMNS } from "@/lib/imports/classes";
import type { ColumnSpec } from "@/lib/imports/headers";
import { GUARDIAN_FIELDS, MAX_BATCH, MAX_GUARDIANS } from "@/lib/integrations/api-records";
import { API_AREAS } from "@/lib/integrations/scopes";
import { API_ERROR_MESSAGES } from "./api";
import { RATE_LIMIT_PER_MINUTE } from "./keys";

type Schema = Record<string, unknown>;

const LIST_FIELDS = new Set(["roles", "subjects", "students"]);

function itemSchema(columns: ColumnSpec[], skip: (key: string) => boolean = () => false): Schema {
  const properties: Record<string, Schema> = {};
  for (const c of columns) {
    if (skip(c.key)) continue;
    const description = `${c.en} (${c.ar}). Spreadsheet header: "${c.en}".`;
    properties[c.key] = LIST_FIELDS.has(c.key)
      ? { description, oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }
      : c.key === "homeroom"
        ? { description, oneOf: [{ type: "boolean" }, { type: "string" }] }
        : c.key === "grade" || c.key === "capacity"
          ? { description, oneOf: [{ type: "integer" }, { type: "string" }] }
          : c.key === "grades"
            ? { description: `${description} For example "9-12".`, oneOf: [{ type: "string" }, { type: "array", items: { type: "integer" } }] }
            : { description, type: "string" };
  }
  return { type: "object", required: columns.filter((c) => c.required && !skip(c.key)).map((c) => c.key), properties };
}

const pageParams = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
  { name: "cursor", in: "query", description: "next_cursor from the previous page.", schema: { type: "string" } },
];

const errorSchema = {
  type: "object",
  properties: { error: { type: "object", properties: { code: { type: "string", enum: Object.keys(API_ERROR_MESSAGES) }, message: { type: "string" } } } },
};

const upsertResult = {
  type: "object",
  properties: {
    import_id: { type: "string", nullable: true, description: "The entry in the Import center history." },
    total: { type: "integer" },
    created: { type: "integer" },
    updated: { type: "integer" },
    unchanged: { type: "integer" },
    failed: { type: "integer" },
    errors: {
      type: "array",
      description: "Item problems. Never contains the submitted values.",
      items: { type: "object", properties: { index: { type: "integer", description: "0-based position in the request array." }, field: { type: "string" }, code: { type: "string" } } },
    },
    unknown_fields: { type: "array", items: { type: "string" }, description: "Field names that were ignored." },
  },
};

const errors = {
  "401": { description: "Missing, unknown or revoked key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "403": { description: "The key does not have the needed scope, or its creator lost access.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "429": { description: `Rate limited (${RATE_LIMIT_PER_MINUTE} requests per minute per key). See Retry-After.`, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

function resource(name: string, area: string, summary: string, itemRef: string, listItem: Schema, extraParams: Schema[] = [], max: number) {
  return {
    get: {
      summary: `List ${summary}`,
      description: `Needs the ${area}:read scope.`,
      security: [{ apiKey: [] }],
      parameters: [...pageParams, ...extraParams],
      responses: {
        "200": { description: "One page", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: listItem }, next_cursor: { type: "string", nullable: true } } } } } },
        ...errors,
      },
    },
    post: {
      summary: `Create or update ${summary}`,
      description: `Needs the ${area}:write scope. Idempotent: sending the same items again changes nothing. At most ${max} items per request. Body: {"${name}": [ ... ]}.`,
      security: [{ apiKey: [] }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: [name], properties: { [name]: { type: "array", maxItems: max, items: { $ref: itemRef } } } } } } },
      responses: { "200": { description: "Result per batch", content: { "application/json": { schema: { $ref: "#/components/schemas/UpsertResult" } } } }, ...errors },
    },
  };
}

export function openApiDocument(baseUrl: string) {
  const guardian: Schema = {
    type: "object",
    required: ["first_name_en", "last_name_en", "email"],
    properties: Object.fromEntries(GUARDIAN_FIELDS.map((f) => [f, f === "relationship" ? { type: "string", enum: ["mother", "father", "guardian", "grandmother", "grandfather", "aunt", "uncle", "other"] } : { type: "string" }])),
  };
  const student = itemSchema(STUDENT_COLUMNS, (k) => k.startsWith("guardian_") || k === "relationship");
  (student.properties as Record<string, Schema>).guardians = { type: "array", maxItems: MAX_GUARDIANS, items: { $ref: "#/components/schemas/Guardian" }, description: "Matched by email. Guardians are added and updated, never removed." };
  const str = { type: "string" };
  const strN = { type: "string", nullable: true };
  return {
    openapi: "3.0.3",
    info: {
      title: "School API",
      version: "1.0.0",
      description:
        "Read and update the school's students and guardians, staff, classes, enrollments and attendance. Upserts use the same rules as the Import center: students match on student number, staff and guardians on email, classes on class code. Create keys under Administration > Integrations. Error messages never repeat submitted values.",
    },
    servers: [{ url: `${baseUrl.replace(/\/+$/, "")}/api/v1` }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: `School API key (hzk_...). Scopes per area: ${API_AREAS.map((a) => `${a}:read, ${a}:write`).join("; ")}.` } },
      schemas: {
        Error: errorSchema,
        UpsertResult: upsertResult,
        Guardian: guardian,
        StudentInput: student,
        StaffInput: itemSchema(STAFF_COLUMNS),
        ClassInput: itemSchema(CLASS_COLUMNS),
        EnrollmentInput: itemSchema(ENROLLMENT_COLUMNS),
        AttendanceInput: {
          type: "object",
          required: ["student_no", "date", "status"],
          properties: { student_no: str, date: { type: "string", format: "date" }, status: { type: "string", enum: ["present", "absent", "late", "excused"] }, minutes_late: { type: "integer", minimum: 0, maximum: 600 } },
        },
      },
    },
    paths: {
      "/students": resource(
        "students",
        "students",
        "students with guardians",
        "#/components/schemas/StudentInput",
        { type: "object", properties: { id: str, student_no: str, first_name_en: str, last_name_en: str, first_name_ar: str, last_name_ar: str, grade: { type: "integer" }, section: strN, date_of_birth: strN, status: str, guardians: { type: "array", items: { type: "object" } } } },
        [
          { name: "status", in: "query", schema: { type: "string", enum: ["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"] } },
          { name: "grade", in: "query", schema: { type: "integer" } },
        ],
        MAX_BATCH.students,
      ),
      "/staff": resource(
        "staff",
        "staff",
        "staff",
        "#/components/schemas/StaffInput",
        { type: "object", properties: { id: str, name_en: str, name_ar: strN, email: str, status: str, roles: { type: "array", items: str }, department: strN, job_title_en: strN, job_title_ar: strN, subjects: { type: "array", items: str }, grades: { type: "array", items: { type: "integer" } } } },
        [],
        MAX_BATCH.staff,
      ),
      "/classes": resource(
        "classes",
        "classes",
        "classes of the current year",
        "#/components/schemas/ClassInput",
        { type: "object", properties: { id: str, class_code: strN, name_en: str, name_ar: str, subject: strN, grade: { type: "integer" }, section: strN, teacher_email: strN, room: strN, capacity: { type: "integer", nullable: true }, homeroom: { type: "boolean" }, option_block: strN, student_count: { type: "integer" } } },
        [],
        MAX_BATCH.classes,
      ),
      "/enrollments": resource(
        "enrollments",
        "classes",
        "class enrollments of the current year",
        "#/components/schemas/EnrollmentInput",
        { type: "object", properties: { id: str, class_id: str, class_code: strN, student_no: str, status: str } },
        [],
        MAX_BATCH.enrollments,
      ),
      "/attendance": resource(
        "attendance",
        "attendance",
        "daily attendance",
        "#/components/schemas/AttendanceInput",
        { type: "object", properties: { id: str, student_no: str, date: str, status: str, minutes_late: { type: "integer", nullable: true } } },
        [
          { name: "from", in: "query", schema: { type: "string", format: "date" }, description: "Default: 30 days ago." },
          { name: "to", in: "query", schema: { type: "string", format: "date" }, description: "Default: today." },
          { name: "student_no", in: "query", schema: { type: "string" } },
        ],
        MAX_BATCH.attendance,
      ),
    },
  };
}
