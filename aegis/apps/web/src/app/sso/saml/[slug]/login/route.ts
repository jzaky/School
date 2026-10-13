import { NextResponse, type NextRequest } from "next/server";
import { beginSamlLogin, env, isAegisError } from "@aegis/core";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { url } = await beginSamlLogin(slug);
    return NextResponse.redirect(url);
  } catch (e) {
    const code = isAegisError(e) && /not enabled|does not sign in/.test(e.message) ? "sso_disabled" : "sso_failed";
    return NextResponse.redirect(`${env().WEB_PUBLIC_URL}/login?error=${code}`);
  }
}
