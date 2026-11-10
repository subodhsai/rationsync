import { SignJWT } from "jose";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db.js";

const SUPABASE_URL = "https://demo-project.supabase.co";
const SECRET = "test-secret-that-is-at-least-32-characters-long";
const logger = pino({ level: "silent" });

const users = {
  beneficiary: { id: "11111111-1111-4111-8111-111111111111", role: "beneficiary", shop: null },
  pendingShop: { id: "22222222-2222-4222-8222-222222222222", role: "shop_admin", shop: "pending" },
  approvedShop: { id: "33333333-3333-4333-8333-333333333333", role: "shop_admin", shop: "approved" },
  warehouse: { id: "44444444-4444-4444-8444-444444444444", role: "warehouse_admin", shop: null },
} as const;

/** Answers the actor lookup from `users` and records every other query. */
function fakeDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("from public.profiles p")) {
        const user = Object.values(users).find((u) => u.id === params[0]);
        if (!user) return { rows: [] };
        return {
          rows: [
            {
              id: user.id,
              role: user.role,
              full_name: "Demo Person",
              preferred_language: "en",
              shop_id: user.shop ? "shop-1" : null,
              fps_id: user.shop ? "DEMO-FPS-MYS-0101" : null,
              shop_name: user.shop ? "Demo FPS Kuvempunagar" : null,
              shop_status: user.shop,
              review_reason: null,
              warehouse_ids: user.role === "warehouse_admin" ? ["wh-1"] : [],
            } as T,
          ],
        };
      }
      return { rows: [] };
    },
  };
  return { db, calls };
}

function configuredApp() {
  const { db, calls } = fakeDb();
  const config = loadConfig({ NODE_ENV: "test", SUPABASE_URL, DATABASE_URL: "postgres://unused" });
  const app = createApp({ config, logger, db, verifyToken: createTokenVerifier(SUPABASE_URL, SECRET) });
  return { app, calls };
}

function token(sub: string, overrides: { issuer?: string; audience?: string; secret?: string } = {}) {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(overrides.issuer ?? `${SUPABASE_URL}/auth/v1`)
    .setAudience(overrides.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(overrides.secret ?? SECRET));
}

describe("without Supabase configuration", () => {
  const app = createApp({ config: loadConfig({ NODE_ENV: "test" }), logger, db: null, verifyToken: null });

  it("serves the health check", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", authConfigured: false });
  });

  it("fails closed on protected routes", async () => {
    const res = await request(app).get("/api/v1/me").set("Authorization", "Bearer anything");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("auth_not_configured");
  });
});

describe("authentication", () => {
  const { app } = configuredApp();

  it("requires a bearer token", async () => {
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("missing_token");
  });

  it.each([
    ["a wrong signature", { secret: "another-secret-that-is-at-least-32-characters" }],
    ["another project's issuer", { issuer: "https://other.supabase.co/auth/v1" }],
    ["a non-session audience", { audience: "anon" }],
  ])("rejects a token with %s", async (_label, overrides) => {
    const res = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${await token(users.beneficiary.id, overrides)}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_token");
  });

  it("rejects a valid token for a user with no profile", async () => {
    const res = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${await token("99999999-9999-4999-8999-999999999999")}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("profile_missing");
  });

  it("returns the profile with the role from the database", async () => {
    const res = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${await token(users.warehouse.id)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: users.warehouse.id, role: "warehouse_admin", warehouseIds: ["wh-1"] });
  });

  it("does not accept HS256 tokens when only asymmetric keys are configured", async () => {
    const verify = createTokenVerifier(SUPABASE_URL);
    await expect(verify(await token(users.beneficiary.id))).rejects.toThrow();
  });
});

describe("authorization", () => {
  const as = async (user: keyof typeof users) => `Bearer ${await token(users[user].id)}`;

  it("keeps beneficiaries out of shop and warehouse areas", async () => {
    const { app } = configuredApp();
    const auth = await as("beneficiary");
    expect((await request(app).get("/api/v1/shop/inventory").set("Authorization", auth)).status).toBe(403);
    expect((await request(app).get("/api/v1/warehouse/shop-registrations").set("Authorization", auth)).status).toBe(403);
  });

  it("withholds shop tools until the shop is approved", async () => {
    const { app } = configuredApp();
    const res = await request(app).get("/api/v1/shop/inventory").set("Authorization", await as("pendingShop"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("shop_not_approved");
  });

  it("scopes inventory to the administrator's own shop", async () => {
    const { app, calls } = configuredApp();
    const res = await request(app).get("/api/v1/shop/inventory").set("Authorization", await as("approvedShop"));
    expect(res.status).toBe(200);
    expect(calls.at(-1)?.params).toEqual(["shop-1"]);
  });

  it("scopes registrations to the administrator's warehouses", async () => {
    const { app, calls } = configuredApp();
    const res = await request(app)
      .get("/api/v1/warehouse/shop-registrations?status=pending")
      .set("Authorization", await as("warehouse"));
    expect(res.status).toBe(200);
    expect(calls.at(-1)?.params).toEqual([["wh-1"], "pending"]);
  });

  it("validates query parameters", async () => {
    const { app } = configuredApp();
    const res = await request(app)
      .get("/api/v1/warehouse/shop-registrations?status=everything")
      .set("Authorization", await as("warehouse"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });
});

describe("CORS", () => {
  const app = createApp({
    config: loadConfig({ NODE_ENV: "test", CORS_ALLOWED_ORIGINS: "https://rationsync.example" }),
    logger,
    db: null,
    verifyToken: null,
  });

  it("allows configured origins", async () => {
    const res = await request(app).options("/api/v1/me").set("Origin", "https://rationsync.example");
    expect(res.headers["access-control-allow-origin"]).toBe("https://rationsync.example");
  });

  it("does not allow other origins", async () => {
    const res = await request(app).options("/api/v1/me").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
