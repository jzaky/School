import { type NextRequest } from "next/server";
import { samlMetadata } from "@aegis/core";

/** Service-provider metadata to load into the identity provider. Public: it contains no secrets. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return new Response(await samlMetadata(slug), { headers: { "content-type": "application/samlmetadata+xml" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
