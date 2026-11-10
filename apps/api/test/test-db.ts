import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
