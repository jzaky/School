// Request bodies with a size limit for route handlers. Next.js limits server action bodies, but not route
// handlers, so a handler that calls req.text() or req.formData() would read any amount into memory. These read
// the stream and stop as soon as the limit is passed.

export class BodyTooLargeError extends Error {
  constructor() {
    super("BODY_TOO_LARGE");
    this.name = "BodyTooLargeError";
  }
}

/** The raw body, refusing more than `maxBytes` (checked against Content-Length first, then while reading). */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The body as UTF-8 text, refusing more than `maxBytes`. */
export async function readTextLimited(req: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBodyLimited(req, maxBytes));
}

/** The body as multipart form data, refusing more than `maxBytes` in total. Null when it is not valid form data. */
export async function readFormLimited(req: Request, maxBytes: number): Promise<FormData | null> {
  const bytes = await readBodyLimited(req, maxBytes);
  try {
    return await new Response(bytes, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return null;
  }
}
