export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "internal";

const statusByCode: Record<ErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

export class AegisError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AegisError";
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }
}

export const notFound = (what: string) => new AegisError("not_found", `${what} not found`);
export const forbidden = (why = "Forbidden") => new AegisError("forbidden", why);
export const unauthorized = (why = "Authentication required") => new AegisError("unauthorized", why);
export const conflict = (why: string) => new AegisError("conflict", why);
export const validation = (why: string, details?: unknown) => new AegisError("validation", why, details);
export const unavailable = (why: string) => new AegisError("unavailable", why);

export function isAegisError(e: unknown): e is AegisError {
  return e instanceof AegisError;
}
