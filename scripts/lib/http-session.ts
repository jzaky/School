// Small HTTP helpers for the capacity scripts (scripts/page-timing.ts and scripts/load-test.ts).
// Signs in through the Auth.js credentials flow (GET /api/auth/csrf, then POST /api/auth/callback/password,
// the same endpoints the sign-in form uses) and keeps the session cookies. Uses the fetch built into Node 20+.
// Each virtual user sends its own X-Forwarded-For address, the way real families arrive through Railway's proxy;
// without it every sign-in would come from one address and hit the per-address sign-in limit.

export type Session = { email: string; ip: string; cookies: Map<string, string> };
export type Timed = { status: number; ms: number; bytes: number; location: string | null; error?: string };

const cookieHeader = (s: Session) => [...s.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

function keepCookies(s: Session, res: Response) {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!value || /expires=thu, 01 jan 1970/i.test(line)) s.cookies.delete(name);
    else s.cookies.set(name, value);
  }
}

/** A stable fake client address per person (10.x.y.z), so rate limits per address behave as in real traffic. */
export function ipFor(n: number) {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export async function signIn(base: string, email: string, password: string, ip: string): Promise<Session> {
  const s: Session = { email, ip, cookies: new Map() };
  const csrfRes = await fetch(`${base}/api/auth/csrf`, { headers: { "x-forwarded-for": ip } });
  keepCookies(s, csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const body = new URLSearchParams({ email, password, csrfToken, callbackUrl: `${base}/en/home` });
  const res = await fetch(`${base}/api/auth/callback/password`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(s), "x-forwarded-for": ip },
    body,
  });
  keepCookies(s, res);
  await res.arrayBuffer();
  const location = res.headers.get("location") ?? "";
  if (![...s.cookies.keys()].some((k) => k.includes("session-token")) || /error/i.test(location)) {
    throw new Error(`sign-in failed for ${email}: ${res.status} ${location}`);
  }
  return s;
}

/** GET a page or file with the session, reading the whole body. Time is from request to last byte. */
export async function timedGet(base: string, s: Session, path: string): Promise<Timed> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}${path}`, { redirect: "manual", headers: { cookie: cookieHeader(s), "x-forwarded-for": s.ip, "accept-language": path.startsWith("/ar") ? "ar" : "en" } });
    const buf = await res.arrayBuffer();
    keepCookies(s, res);
    return { status: res.status, ms: performance.now() - t0, bytes: buf.byteLength, location: res.headers.get("location") };
  } catch (e) {
    return { status: 0, ms: performance.now() - t0, bytes: 0, location: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** POST a Next.js server action the way the browser does (used by the load test to save registers). */
export async function timedAction(base: string, s: Session, path: string, actionId: string, args: unknown[]): Promise<Timed> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: cookieHeader(s), "x-forwarded-for": s.ip, "next-action": actionId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" },
      body: JSON.stringify(args),
    });
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString("utf8");
    const failed = res.status !== 200 || /"ok":false/.test(text);
    return { status: failed && res.status === 200 ? 422 : res.status, ms: performance.now() - t0, bytes: buf.byteLength, location: res.headers.get("location"), error: failed ? text.slice(0, 200) : undefined };
  } catch (e) {
    return { status: 0, ms: performance.now() - t0, bytes: 0, location: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/** Run tasks with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}
