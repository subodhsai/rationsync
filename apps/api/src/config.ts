import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SUPABASE_URL: z.url().optional(),
  // Only for projects still signing sessions with the legacy shared secret (HS256).
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_CA_CERT: z.string().min(1).optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  logLevel: string;
  supabaseUrl?: string;
  jwtSecret?: string;
  databaseUrl?: string;
  databaseCaCert?: string;
  corsOrigins: string[];
  /** Variables that protected routes need; empty when fully configured. */
  missing: string[];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Treat `KEY=` lines copied from .env.example as unset.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;

  const missing = [!e.SUPABASE_URL && "SUPABASE_URL", !e.DATABASE_URL && "DATABASE_URL"].filter(
    (v): v is string => Boolean(v),
  );

  if (e.NODE_ENV === "production") {
    const required = e.CORS_ALLOWED_ORIGINS ? missing : [...missing, "CORS_ALLOWED_ORIGINS"];
    if (required.length > 0) {
      throw new Error(`Missing required environment variables: ${required.join(", ")}`);
    }
  }

  const corsOrigins = (e.CORS_ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (corsOrigins.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS must list explicit origins; '*' is not allowed");
  }

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    supabaseUrl: e.SUPABASE_URL?.replace(/\/$/, ""),
    jwtSecret: e.SUPABASE_JWT_SECRET,
    databaseUrl: e.DATABASE_URL,
    databaseCaCert: e.DATABASE_CA_CERT,
    corsOrigins,
    missing,
  };
}
