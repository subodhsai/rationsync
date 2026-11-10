"use server";

import { ROLE_HOME } from "@rationsync/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { demoMe } from "@/lib/fixtures";
import { DEMO_COOKIE, isDemoPersona } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function startDemo(formData: FormData) {
  const persona = formData.get("persona");
  // Preview mode exists only until real sign-in is configured.
  if (isSupabaseConfigured || !isDemoPersona(persona)) redirect("/");

  (await cookies()).set(DEMO_COOKIE, persona, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  redirect(ROLE_HOME[demoMe[persona].role]);
}

export async function signOut() {
  if (isSupabaseConfigured) {
    await (await createSupabaseServerClient()).auth.signOut();
  } else {
    (await cookies()).delete(DEMO_COOKIE);
  }
  redirect("/");
}
