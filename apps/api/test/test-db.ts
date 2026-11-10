import { PGlite } from "@electric-sql/pglite";
import { SignJWT } from "jose";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pino } from "pino";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";

const supabaseDir = join(import.meta.dirname, "../../../supabase");

/** In-memory Postgres with the Supabase stub, every migration, and the demo seed applied. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-stub.sql"), "utf8"));
  for (const file of readdirSync(join(supabaseDir, "migrations")).sort()) {
    await db.exec(readFileSync(join(supabaseDir, "migrations", file), "utf8"));
  }
  await db.exec(readFileSync(join(supabaseDir, "seed.sql"), "utf8"));
  return db;
}

export async function createUser(db: PGlite, email: string, metadata: Record<string, string> = {}) {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(metadata)],
  );
  return rows[0]!.id;
}

export async function linkCard(db: PGlite, userId: string, shopId: string) {
  await db.query(
    `insert into public.beneficiary_cards (user_id, card_id)
     select $1, id from public.demo_ration_cards rc
      where rc.shop_id = $2 and not exists (select 1 from public.beneficiary_cards bc where bc.card_id = rc.id)
      order by rc.card_number
      limit 1`,
    [userId, shopId],
  );
}

const SUPABASE_URL = "https://demo-project.supabase.co";
const SECRET = "test-secret-that-is-at-least-32-characters-long";

/** The real Express app wired to a PGlite database, accepting test-signed HS256 sessions. */
export function createTestApp(pg: PGlite) {
  const config = loadConfig({ NODE_ENV: "test", SUPABASE_URL, DATABASE_URL: "pglite" });
  const app = createApp({
    config,
    logger: pino({ level: "silent" }),
    db: { query: (text, params) => pg.query(text, params) },
    verifyToken: createTokenVerifier(SUPABASE_URL, SECRET),
  });
  const bearer = async (sub: string) =>
    `Bearer ${await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience("authenticated")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(SECRET))}`;
  return { app, bearer };
}
