import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lands here from the email confirmation link, in either the PKCE (code) or token-hash form.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next") ?? "/dashboard";
  // Only same-site paths, never "//host" or absolute URLs.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const supabase = await createSupabaseServerClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing confirmation parameters") };

  return NextResponse.redirect(new URL(error ? "/login?confirm=failed" : destination, origin));
}
