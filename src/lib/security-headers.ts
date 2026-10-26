// Browser security headers. The static set is sent on every response (next.config.ts); the content security
// policy carries a fresh nonce per request and is set by src/middleware.ts on pages.
// Edge-safe: no Node.js imports, so the middleware can use it.

/** Sign-in providers a native form post may be redirected to before the page has loaded its scripts. */
const FORM_TARGETS = ["https://accounts.google.com", "https://login.microsoftonline.com"];

export function contentSecurityPolicy(nonce: string, opts: { dev?: boolean } = {}): string {
  const dev = Boolean(opts.dev);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js puts the nonce on its own scripts; scripts they load are trusted through strict-dynamic.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Inline styles come from the UI libraries (animations, charts, scroll locking). No nonce here, or browsers
    // would ignore 'unsafe-inline'.
    "style-src": ["'self'", "'unsafe-inline'"],
    // School logos and photos are served through short-lived signed links on the file store.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "media-src": ["'self'", "blob:"],
    "frame-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...FORM_TARGETS],
    "frame-ancestors": ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

/** A random nonce for one response (base64 of 16 random bytes). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Headers for every response. HSTS is ignored by browsers on plain HTTP, so local runs are unaffected. */
export const STATIC_SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Nothing in Horizon uses the camera, microphone, location or payment APIs (the class session QR code is
  // shown on screen and scanned by the phone's own camera app).
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];
