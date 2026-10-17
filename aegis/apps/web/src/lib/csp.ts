/**
 * Content-Security-Policy for every page AEGIS serves.
 *
 * Scripts run only with the per-request nonce the middleware generates (Next.js stamps it on its own
 * scripts; the root layout stamps it on the theme script). 'strict-dynamic' lets those trusted scripts
 * load the chunks they need, and nothing else. The console loads nothing from other origins, so
 * everything else is 'self'. Forms may submit to https targets because single sign-on starts with a
 * form that redirects to the organization's identity provider, and browsers apply form-action to
 * that redirect.
 */
export function buildCsp(nonce: string, dev = process.env.NODE_ENV !== "production"): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // The development server evaluates code for fast refresh; production never does.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Inline style attributes are used by the console's components and charts.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", "https:"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

/** A fresh, unguessable nonce (128 bits, base64) for one request. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
