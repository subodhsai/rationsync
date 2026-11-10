import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

const PROTECTED = ["/shop", "/warehouse", "/beneficiary", "/dashboard"];
const DEMO_COOKIE = "rs_demo_persona";

function toLogin(request: NextRequest) {
  return NextResponse.redirect(new URL("/login", request.url));
}

// Keeps the Supabase session fresh and sends signed-out visitors to sign-in before any page
// renders. Which role may see what is decided by the layouts (via the API) and the API itself.
export async function proxy(request: NextRequest) {
  const isProtected = PROTECTED.some((p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(`${p}/`));

  if (!isSupabaseConfigured) {
    return isProtected && !request.cookies.has(DEMO_COOKIE) ? toLogin(request) : NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getClaims verifies the token signature; an absent or invalid session yields no claims.
  const { data } = await supabase.auth.getClaims();
  if (isProtected && !data?.claims) return toLogin(request);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
