import type { PGlite } from "@electric-sql/pglite";
import { SignJWT } from "jose";
import { pino } from "pino";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db.js";
import { createTestDb, createUser, linkCard } from "./test-db.js";

// The real Express app and route SQL against the real migration and seed.

const SUPABASE_URL = "https://demo-project.supabase.co";
const SECRET = "test-secret-that-is-at-least-32-characters-long";
const MYS_SHOP = "0d9a0000-0000-4000-b000-000000000101";
const MYS_WAREHOUSE = "0d9a0000-0000-4000-a000-000000000001";
const DWD_WAREHOUSE = "0d9a0000-0000-4000-a000-000000000002";

let pg: PGlite;
let app: ReturnType<typeof createApp>;
const ids: Record<"beneficiary" | "unlinked" | "shopAdmin" | "pendingAdmin" | "warehouseAdmin", string> = {} as never;

const bearer = async (sub: string) =>
  `Bearer ${await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience("authenticated")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET))}`;

const get = async (path: string, user: keyof typeof ids) =>
  request(app).get(path).set("Authorization", await bearer(ids[user]));

async function addShop(fpsId: string, warehouseId: string, ownerId: string | null) {
  await pg.query(
    `insert into public.shops (fps_id, warehouse_id, owner_id, name, district, taluk, address, contact_phone)
     values ($1, $2, $3, $4, 'Demo', 'Demo', 'Demo address', '+91 90000 00999')`,
    [fpsId, warehouseId, ownerId, `Demo shop ${fpsId}`],
  );
}

beforeAll(async () => {
  pg = await createTestDb();
  const db: Db = { query: (text, params) => pg.query(text, params) };

  ids.beneficiary = await createUser(pg, "beneficiary@example.test");
  ids.unlinked = await createUser(pg, "unlinked@example.test");
  ids.shopAdmin = await createUser(pg, "shop@example.test", { account_type: "shop_admin", full_name: "Demo Owner" });
  ids.pendingAdmin = await createUser(pg, "pending@example.test", { account_type: "shop_admin" });
  ids.warehouseAdmin = await createUser(pg, "wh@example.test");

  await linkCard(pg, ids.beneficiary, MYS_SHOP);
  await pg.query("update public.shops set owner_id = $1 where id = $2", [ids.shopAdmin, MYS_SHOP]);
  await addShop("DEMO-FPS-MYS-0999", MYS_WAREHOUSE, ids.pendingAdmin);
  await addShop("DEMO-FPS-DWD-0999", DWD_WAREHOUSE, null);
  await pg.query("select public.provision_warehouse_admin('wh@example.test', 'DEMO-WH-MYS')");
  await pg.query(
    `select public.book_slot((select id from public.appointment_slots where shop_id = $1 and starts_at > now()
                               order by starts_at limit 1), $2)`,
    [MYS_SHOP, ids.beneficiary],
  );

  const config = loadConfig({ NODE_ENV: "test", SUPABASE_URL, DATABASE_URL: "pglite" });
  app = createApp({ config, logger: pino({ level: "silent" }), db, verifyToken: createTokenVerifier(SUPABASE_URL, SECRET) });
}, 60_000);

describe("GET /api/v1/me", () => {
  it("returns the shop and approval state for a shop administrator", async () => {
    const res = await get("/api/v1/me", "shopAdmin");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      role: "shop_admin",
      fullName: "Demo Owner",
      shop: { id: MYS_SHOP, fpsId: "DEMO-FPS-MYS-0101", status: "approved" },
      warehouseIds: [],
    });
  });

  it("returns warehouse assignments for a provisioned administrator", async () => {
    const res = await get("/api/v1/me", "warehouseAdmin");
    expect(res.body).toMatchObject({ role: "warehouse_admin", shop: null, warehouseIds: [MYS_WAREHOUSE] });
  });
});

describe("GET /api/v1/shop/inventory", () => {
  it("returns the seeded ledger balances for an approved shop", async () => {
    const res = await get("/api/v1/shop/inventory", "shopAdmin");
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { commodityCode: string; quantity: number }) => [i.commodityCode, i.quantity])).toEqual([
      ["RICE", 1840],
      ["WHEAT", 120],
      ["RAGI", 410],
      ["SUGAR", 35],
    ]);
  });

  it("refuses a shop that is still pending", async () => {
    const res = await get("/api/v1/shop/inventory", "pendingAdmin");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("shop_not_approved");
  });
});

describe("GET /api/v1/warehouse/shop-registrations", () => {
  it("lists only shops under the administrator's own warehouse", async () => {
    const res = await get("/api/v1/warehouse/shop-registrations?status=pending", "warehouseAdmin");
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { fpsId: string }) => r.fpsId)).toEqual(["DEMO-FPS-MYS-0999"]);
  });

  it("filters by status", async () => {
    const res = await get("/api/v1/warehouse/shop-registrations?status=approved", "warehouseAdmin");
    expect(res.body.items.map((r: { fpsId: string }) => r.fpsId).sort()).toEqual(["DEMO-FPS-MYS-0101", "DEMO-FPS-MYS-0102"]);
  });

  it("is closed to shop administrators", async () => {
    expect((await get("/api/v1/warehouse/shop-registrations", "shopAdmin")).status).toBe(403);
  });
});

describe("GET /api/v1/beneficiary/overview", () => {
  it("returns the linked shop, availability levels, masked card and next booking", async () => {
    const res = await get("/api/v1/beneficiary/overview", "beneficiary");
    expect(res.status).toBe(200);
    expect(res.body.shop.fpsId).toBe("DEMO-FPS-MYS-0101");
    expect(res.body.card.cardNumber).toMatch(/^•+\d{2}$/);
    expect(res.body.stock.map((s: { commodityCode: string; level: string }) => [s.commodityCode, s.level])).toEqual([
      ["RICE", "ok"],
      ["WHEAT", "low"],
      ["RAGI", "ok"],
      ["SUGAR", "low"],
    ]);
    expect(res.body.stock[0]).not.toHaveProperty("quantity");
    expect(res.body.upcomingBooking).toMatchObject({ status: "booked" });
  });

  it("returns an empty overview before a card is linked", async () => {
    const res = await get("/api/v1/beneficiary/overview", "unlinked");
    expect(res.body).toEqual({ card: null, shop: null, stock: [], upcomingBooking: null });
  });
});
