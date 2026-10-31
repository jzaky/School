/**
 * The page to open after signing in: a path on this site, or the overview.
 *
 * A path starts with one slash followed by neither another slash nor a backslash: browsers read "//host" and
 * "/\host" as another site, which would turn the sign-in page into an open redirect. Whitespace and control
 * characters are refused too, and so is the sign-in page itself.
 */
export function safeNext(value: unknown): string {
  const v = typeof value === "string" ? value : "";
  if (!/^\/(?![/\\])[^\\\s\u0000-\u001f\u007f]*$/.test(v)) return "/overview";
  if (v.startsWith("/login")) return "/overview";
  return v;
}
