import "server-only";
import { ROLE_HOME, type AppRole, type Me } from "@rationsync/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ApiError, apiGet } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/env";
import { DEMO_PERSONAS, demoMe, type DemoPersona } from "@/lib/fixtures";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const DEMO_COOKIE = "rs_demo_persona";

export type Session =
  | { mode: "demo"; persona: DemoPersona; me: Me }
  | { mode: "live"; me: Me; accessToken: string };

export function isDemoPersona(value: unknown): value is DemoPersona {
  return DEMO_PERSONAS.includes(value as DemoPersona);
}

/**
 * The signed-in person, or null. In live mode the role comes from the API, which verifies
 * the Supabase token and reads the profile from the database; nothing here trusts the cookie.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!isSupabaseConfigured) {
    const persona = (await cookies()).get(DEMO_COOKIE)?.value;
    return isDemoPersona(persona) ? { mode: "demo", persona, me: demoMe[persona] } : null;
  }

  const supabase = await createSupabaseServerClient();
  const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
  if (!accessToken) return null;

  try {
    return { mode: "live", me: await apiGet<Me>("/api/v1/me", accessToken), accessToken };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
});

export async function requireRole(role: AppRole): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.me.role !== role) redirect(ROLE_HOME[session.me.role]);
  return session;
}

/** Shop pages beyond the status screen exist only for approved shops. */
export async function requireApprovedShop(): Promise<Session & { me: { shop: NonNullable<Me["shop"]> } }> {
  const session = await requireRole("shop_admin");
  if (session.me.shop?.status !== "approved") redirect("/shop/status");
  return session as Session & { me: { shop: NonNullable<Me["shop"]> } };
}
