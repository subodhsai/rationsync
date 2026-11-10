// NEXT_PUBLIC_* values are inlined into browser code at build time. They must never hold secrets.
export const publicEnv = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, ""),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
};

/** Without Supabase the app runs in preview mode on labelled fictional fixtures. */
export const isSupabaseConfigured = Boolean(publicEnv.supabaseUrl && publicEnv.supabasePublishableKey);
