// Redirect with a relative Location header. Behind the hosting proxy, req.url carries the container's own
// address (for example 0.0.0.0:3000), so an absolute URL built from it sends the browser nowhere.
export function redirectTo(path: string, status = 307): Response {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("redirectTo needs a path on this site");
  return new Response(null, { status, headers: { Location: path } });
}
