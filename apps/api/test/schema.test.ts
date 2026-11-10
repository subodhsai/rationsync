import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser as createUserIn, linkCard as linkCardIn } from "./test-db.js";

const SHOP = "0d9a0000-0000-4000-b000-000000000101";
const OTHER_SHOP = "0d9a0000-0000-4000-b000-000000000201";

let db: PGlite;
const createUser = (email: string, metadata?: Record<string, string>) => createUserIn(db, email, metadata);
const linkCard = (userId: string, shopId: string) => linkCardIn(db, userId, shopId);

// Each query runs in its own implicit transaction, so a failure leaves nothing behind.
async function rejects(sql: string, params: unknown[], message: RegExp) {
  await expect(db.query(sql, params)).rejects.toThrow(message);
}

const DENIED = /permission denied/;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

describe("seed", () => {
  it("loads fictional shops whose stock matches their ledger", async () => {
    const { rows } = await db.query<{ mismatches: number; shops: number }>(
      `select (select count(*)::int from public.shops) as shops,
              (select count(*)::int from public.shop_inventory i
                where i.quantity <> coalesce((select sum(quantity_delta) from public.stock_movements m
                                              where m.shop_id = i.shop_id and m.commodity_code = i.commodity_code), 0)
              ) as mismatches`,
    );
    expect(rows[0]).toEqual({ shops: 4, mismatches: 0 });
  });

  it("creates future appointment slots", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.appointment_slots where starts_at > now()",
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

describe("sign-up", () => {
  it("creates a profile and never grants warehouse_admin from metadata", async () => {
    const shopUser = await createUser("shop@example.test", { account_type: "shop_admin", full_name: "Demo Shop" });
    const sneaky = await createUser("sneaky@example.test", { account_type: "warehouse_admin" });
    const { rows } = await db.query<{ id: string; role: string }>(
      "select id, role from public.profiles where id = any($1::uuid[])",
      [[shopUser, sneaky]],
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.role]))).toEqual({
      [shopUser]: "shop_admin",
      [sneaky]: "beneficiary",
    });
  });

  it("only assigns warehouses to provisioned warehouse admins", async () => {
    const user = await createUser("not-admin@example.test");
    await rejects(
      "insert into public.warehouse_admins (user_id, warehouse_id) values ($1, '0d9a0000-0000-4000-a000-000000000001')",
      [user],
      /requires the warehouse_admin role/,
    );
    await createUser("wh@example.test");
    await db.query("select public.provision_warehouse_admin('wh@example.test', 'DEMO-WH-MYS')");
    const { rows } = await db.query<{ role: string; assignments: number }>(
      `select p.role, (select count(*)::int from public.warehouse_admins wa where wa.user_id = p.id) as assignments
         from public.profiles p join auth.users u on u.id = p.id where u.email = 'wh@example.test'`,
    );
    expect(rows[0]).toEqual({ role: "warehouse_admin", assignments: 1 });
  });
});

describe("shops", () => {
  it("rejects a duplicate FPS ID", async () => {
    await rejects(
      `insert into public.shops (fps_id, warehouse_id, name, district, taluk, address, contact_phone)
       values ('DEMO-FPS-MYS-0101', '0d9a0000-0000-4000-a000-000000000001', 'Copy', 'Mysuru', 'Mysuru', 'x', 'x')`,
      [],
      /shops_fps_id_key/,
    );
  });

  it("rejects lower-case FPS IDs so uniqueness cannot be bypassed by case", async () => {
    await rejects(
      `insert into public.shops (fps_id, warehouse_id, name, district, taluk, address, contact_phone)
       values ('demo-fps-mys-0101', '0d9a0000-0000-4000-a000-000000000001', 'Copy', 'Mysuru', 'Mysuru', 'x', 'x')`,
      [],
      /shops_fps_id_check/,
    );
  });

  it("requires a reason to reject a registration", async () => {
    await rejects(`update public.shops set status = 'rejected', reviewed_at = now(), review_reason = null where id = $1`, [
      SHOP,
    ], /shops_rejection_reason/);
  });

  it("refuses a shop owner who is not a shop admin", async () => {
    const beneficiary = await createUser("owner-beneficiary@example.test");
    await rejects(`update public.shops set owner_id = $1 where id = $2`, [beneficiary, SHOP], /must have the shop_admin role/);
  });
});

describe("stock movements", () => {
  const balance = async () =>
    (
      await db.query<{ quantity: number }>(
        "select quantity::float8 as quantity from public.shop_inventory where shop_id = $1 and commodity_code = 'SUGAR'",
        [SHOP],
      )
    ).rows[0]!.quantity;

  it("applies a distribution and records the balance", async () => {
    const before = await balance();
    const { rows } = await db.query<{ balance_after: number }>(
      `select (public.apply_stock_movement($1, 'SUGAR', 'distribution', -5, 'Test distribution', null, 'test-dist-0001')).balance_after::float8 as balance_after`,
      [SHOP],
    );
    expect(rows[0]!.balance_after).toBe(before - 5);
    expect(await balance()).toBe(before - 5);
  });

  it("does not apply the same idempotency key twice", async () => {
    const before = await balance();
    await db.query(
      "select public.apply_stock_movement($1, 'SUGAR', 'distribution', -5, 'Test distribution', null, 'test-dist-0001')",
      [SHOP],
    );
    expect(await balance()).toBe(before);
  });

  it("refuses to take stock below zero and leaves no partial record", async () => {
    const before = await balance();
    await rejects(
      "select public.apply_stock_movement($1, 'SUGAR', 'distribution', -100000, 'Too much', null, 'test-dist-overdraw')",
      [SHOP],
      /shop_inventory_quantity_check/,
    );
    expect(await balance()).toBe(before);
    const { rows } = await db.query(
      "select 1 from public.stock_movements where idempotency_key = 'test-dist-overdraw'",
    );
    expect(rows).toHaveLength(0);
  });

  it("rejects a distribution recorded as a positive quantity", async () => {
    await rejects(
      "select public.apply_stock_movement($1, 'SUGAR', 'distribution', 5, 'Wrong sign', null, 'test-dist-wrongsign')",
      [SHOP],
      /stock_movements_direction/,
    );
  });

  it("keeps the ledger append-only", async () => {
    await rejects("update public.stock_movements set quantity_delta = 1", [], /append-only/);
    await rejects("delete from public.stock_movements", [], /append-only/);
  });
});

describe("bookings", () => {
  it("fills a slot to capacity and no further", async () => {
    const { rows: slots } = await db.query<{ id: string }>(
      `insert into public.appointment_slots (shop_id, starts_at, ends_at, capacity)
       values ($1, now() + interval '30 days', now() + interval '30 days 2 hours', 1) returning id`,
      [SHOP],
    );
    const slot = slots[0]!.id;
    const first = await createUser("b1@example.test");
    const second = await createUser("b2@example.test");
    await linkCard(first, SHOP);
    await linkCard(second, SHOP);

    await db.query("select public.book_slot($1, $2)", [slot, first]);
    await rejects("select public.book_slot($1, $2)", [slot, second], /Slot is full/);

    const { rows } = await db.query<{ booked_count: number }>(
      "select booked_count from public.appointment_slots where id = $1",
      [slot],
    );
    expect(rows[0]!.booked_count).toBe(1);
  });

  it("allows one active booking per beneficiary and frees the seat on cancel", async () => {
    const user = await createUser("b3@example.test");
    await linkCard(user, SHOP);
    const { rows: slots } = await db.query<{ id: string }>(
      "select id from public.appointment_slots where shop_id = $1 and starts_at > now() order by starts_at limit 2",
      [SHOP],
    );
    const [a, b] = slots.map((s) => s.id);

    const { rows: booked } = await db.query<{ id: string }>("select (public.book_slot($1, $2)).id as id", [a, user]);
    await rejects("select public.book_slot($1, $2)", [b, user], /bookings_one_active_per_beneficiary/);

    await db.query("select public.cancel_booking($1, $2)", [booked[0]!.id, user]);
    const { rows } = await db.query<{ booked_count: number }>(
      "select booked_count from public.appointment_slots where id = $1",
      [a],
    );
    expect(rows[0]!.booked_count).toBe(0);
    await db.query("select public.book_slot($1, $2)", [b, user]);
  });

  it("refuses a slot at a shop other than the beneficiary's linked shop", async () => {
    const user = await createUser("b4@example.test");
    await linkCard(user, SHOP);
    const { rows } = await db.query<{ id: string }>(
      "select id from public.appointment_slots where shop_id = $1 and starts_at > now() limit 1",
      [OTHER_SHOP],
    );
    await rejects("select public.book_slot($1, $2)", [rows[0]!.id, user], /not at your linked shop/);
  });
});

describe("browser roles (publishable key)", () => {
  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role; reset request.jwt.claim.sub;");
    }
  }

  it("can read only its own profile", async () => {
    const me = await createUser("rls-me@example.test");
    await createUser("rls-other@example.test");
    const rows = await asUser(me, async () => (await db.query<{ id: string }>("select id from public.profiles")).rows);
    expect(rows.map((r) => r.id)).toEqual([me]);
  });

  it("cannot change its own role", async () => {
    const me = await createUser("rls-escalate@example.test");
    await asUser(me, () => rejects("update public.profiles set role = 'warehouse_admin' where id = $1", [me], DENIED));
  });

  it("cannot change stock, read shops, or call privileged functions", async () => {
    const me = await createUser("rls-stock@example.test");
    await asUser(me, async () => {
      await rejects("update public.shop_inventory set quantity = 999999", [], DENIED);
      await rejects("select * from public.shops", [], DENIED);
      await rejects(
        "select public.apply_stock_movement($1, 'RICE', 'receipt', 10, 'Not allowed', null, 'rls-attempt-1')",
        [SHOP],
        DENIED,
      );
      await rejects("select public.provision_warehouse_admin('rls-stock@example.test', 'DEMO-WH-MYS')", [], DENIED);
    });
  });

  it("cannot rewrite the audit log, even as the database owner", async () => {
    await rejects("delete from public.audit_log", [], /append-only/);
    await rejects("update public.audit_log set reason = 'changed'", [], /append-only/);
  });
});

// Phase 2 ---------------------------------------------------------------------

const MYS_WAREHOUSE = "0d9a0000-0000-4000-a000-000000000001";

async function submit(ownerId: string, fpsId: string, warehouseId = MYS_WAREHOUSE) {
  const { rows } = await db.query<{ id: string; status: string }>(
    `select id, status from public.submit_shop_registration($1, $2, 'Demo applicant shop', 'Mysuru', 'Mysuru',
       '1st Cross, Demo Layout, Mysuru', '570001', '+91 90000 11111', null, $3)`,
    [ownerId, fpsId, warehouseId],
  );
  return rows[0]!;
}

async function provision(email: string, code: string) {
  const id = await createUser(email);
  await db.query("select public.provision_warehouse_admin($1, $2)", [email, code]);
  return id;
}

const submitSql =
  "select public.submit_shop_registration($1, $2, 'Demo applicant shop', 'Mysuru', 'Mysuru', 'address here', '570001', '1', null, $3)";

describe("shop applications", () => {
  let mysAdmin: string;
  let dwdAdmin: string;

  beforeAll(async () => {
    mysAdmin = await provision("p2-mys-admin@example.test", "DEMO-WH-MYS");
    dwdAdmin = await provision("p2-dwd-admin@example.test", "DEMO-WH-DWD");
  });

  it("starts pending and is audit-logged", async () => {
    const owner = await createUser("p2-owner-1@example.test", { account_type: "shop_admin" });
    const shop = await submit(owner, "DEMO-FPS-MYS-0301");
    expect(shop.status).toBe("pending");
    const { rows } = await db.query(
      "select 1 from public.audit_log where action = 'shop.registration_submitted' and entity_id = $1",
      [shop.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses a second application while one is pending", async () => {
    const owner = await createUser("p2-owner-2@example.test", { account_type: "shop_admin" });
    await submit(owner, "DEMO-FPS-MYS-0302");
    await rejects(submitSql, [owner, "DEMO-FPS-MYS-0399", MYS_WAREHOUSE], /already has a pending application/);
  });

  it("refuses an FPS ID already registered by another account", async () => {
    const owner = await createUser("p2-owner-3@example.test", { account_type: "shop_admin" });
    await rejects(submitSql, [owner, "DEMO-FPS-MYS-0101", MYS_WAREHOUSE], /shops_fps_id_key/);
  });

  it("does not let a beneficiary account apply", async () => {
    const beneficiary = await createUser("p2-beneficiary@example.test");
    await rejects(submitSql, [beneficiary, "DEMO-FPS-MYS-0398", MYS_WAREHOUSE], /must have the shop_admin role/);
  });

  it("lets only an administrator of the shop's warehouse decide, exactly once", async () => {
    const owner = await createUser("p2-owner-4@example.test", { account_type: "shop_admin" });
    const shop = await submit(owner, "DEMO-FPS-MYS-0304");
    const review = "select public.review_shop($1, $2, $3, $4)";

    await rejects(review, [shop.id, dwdAdmin, "approved", "Looks right"], /No such application/);
    await rejects(review, [shop.id, owner, "approved", "Looks right"], /No such application/);

    await db.query(review, [shop.id, mysAdmin, "approved", "Licence checked against demo record"]);
    await rejects(review, [shop.id, mysAdmin, "rejected", "Changed my mind"], /already approved/);

    const { rows } = await db.query<{ reviews: number; audits: number; notices: number }>(
      `select (select count(*)::int from public.shop_reviews where shop_id = $1) as reviews,
              (select count(*)::int from public.audit_log where action = 'shop.approved' and entity_id = $1::text) as audits,
              (select count(*)::int from public.notifications where user_id = $2 and kind = 'shop.reviewed') as notices`,
      [shop.id, owner],
    );
    expect(rows[0]).toEqual({ reviews: 1, audits: 1, notices: 1 });
  });

  it("decides concurrent reviews once", async () => {
    const owner = await createUser("p2-owner-5@example.test", { account_type: "shop_admin" });
    const shop = await submit(owner, "DEMO-FPS-MYS-0305");
    const results = await Promise.allSettled([
      db.query("select public.review_shop($1, $2, 'approved', 'First reviewer')", [shop.id, mysAdmin]),
      db.query("select public.review_shop($1, $2, 'rejected', 'Second reviewer')", [shop.id, mysAdmin]),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.shop_reviews where shop_id = $1",
      [shop.id],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("allows a corrected resubmission after rejection and keeps the decision history", async () => {
    const owner = await createUser("p2-owner-6@example.test", { account_type: "shop_admin" });
    const shop = await submit(owner, "DEMO-FPS-MYS-0306");
    await rejects("select public.review_shop($1, $2, 'rejected', 'x')", [shop.id, mysAdmin], /reason/);
    await db.query("select public.review_shop($1, $2, 'rejected', 'FPS ID does not match the licence')", [
      shop.id,
      mysAdmin,
    ]);

    const again = await submit(owner, "DEMO-FPS-MYS-0316");
    expect(again).toEqual({ id: shop.id, status: "pending" });
    const { rows } = await db.query<{ reviewed_at: string | null; decisions: number }>(
      `select reviewed_at, (select count(*)::int from public.shop_reviews where shop_id = $1) as decisions
         from public.shops where id = $1`,
      [shop.id],
    );
    expect(rows[0]).toEqual({ reviewed_at: null, decisions: 1 });
  });

  it("never moves a shop to a different owner", async () => {
    const owner = await createUser("p2-owner-7@example.test", { account_type: "shop_admin" });
    const other = await createUser("p2-owner-8@example.test", { account_type: "shop_admin" });
    const shop = await submit(owner, "DEMO-FPS-MYS-0307");
    await rejects("update public.shops set owner_id = $1 where id = $2", [other, shop.id], /ownership cannot be transferred/);
  });

  it("refuses stock movements for a shop that is not approved", async () => {
    const owner = await createUser("p2-owner-9@example.test", { account_type: "shop_admin" });
    const shop = await submit(owner, "DEMO-FPS-MYS-0309");
    await rejects(
      "select public.apply_stock_movement($1, 'RICE', 'opening_balance', 100, 'Opening', $2, 'p2-pending-open-1')",
      [shop.id, owner],
      /approved shop/,
    );
  });
});

describe("low-stock alerts", () => {
  // Seeded: JOWAR 610 kg (threshold 200), RICE 640 kg (threshold 800, already alerting).
  const SHOP3 = "0d9a0000-0000-4000-b000-000000000202";
  const openAlerts = async (code: string) =>
    (
      await db.query<{ n: number }>(
        "select count(*)::int as n from public.stock_alerts where shop_id = $1 and commodity_code = $2 and status = 'open'",
        [SHOP3, code],
      )
    ).rows[0]!.n;
  const jowar = async () =>
    (
      await db.query<{ q: number }>(
        "select quantity::float8 as q from public.shop_inventory where shop_id = $1 and commodity_code = 'JOWAR'",
        [SHOP3],
      )
    ).rows[0]!.q;
  const move = (delta: number, key: string) =>
    db.query("select public.apply_stock_movement($1, 'JOWAR', $2, $3, 'Alert test', null, $4)", [
      SHOP3,
      delta < 0 ? "distribution" : "adjustment",
      delta,
      key,
    ]);

  it("opens seeded alerts for rows already at or below threshold", async () => {
    expect(await openAlerts("RICE")).toBe(1);
    expect(await openAlerts("JOWAR")).toBe(0);
  });

  it("opens one alert when a movement crosses the threshold, and no duplicates", async () => {
    await move(-400, "alert-test-0001"); // 210, still above 200
    expect(await openAlerts("JOWAR")).toBe(0);
    await move(-10, "alert-test-0002"); // 200, at the threshold
    expect(await openAlerts("JOWAR")).toBe(1);
    await move(-50, "alert-test-0003"); // 150, still low
    expect(await openAlerts("JOWAR")).toBe(1);
  });

  it("resolves the alert when stock rises above the threshold", async () => {
    await move(100, "alert-test-0004"); // 250
    expect(await openAlerts("JOWAR")).toBe(0);
    const { rows } = await db.query<{ status: string; quantity_at_resolve: number }>(
      `select status, quantity_at_resolve::float8 as quantity_at_resolve from public.stock_alerts
        where shop_id = $1 and commodity_code = 'JOWAR' order by opened_at desc limit 1`,
      [SHOP3],
    );
    expect(rows[0]).toEqual({ status: "resolved", quantity_at_resolve: 250 });
  });

  it("re-evaluates when the threshold changes, and audits the change", async () => {
    await db.query("select public.set_low_stock_threshold($1, 'JOWAR', 300, null)", [SHOP3]);
    expect(await openAlerts("JOWAR")).toBe(1);
    await db.query("select public.set_low_stock_threshold($1, 'JOWAR', 100, null)", [SHOP3]);
    expect(await openAlerts("JOWAR")).toBe(0);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where action = 'inventory.threshold_changed' and entity_id = $1",
      [SHOP3],
    );
    expect(rows[0]!.n).toBe(2);
  });

  it("records an opening balance only once per commodity", async () => {
    await rejects(
      "select public.apply_stock_movement($1, 'JOWAR', 'opening_balance', 5, 'Second opening', null, 'alert-test-open-2')",
      [SHOP3],
      /stock_movements_one_opening_balance/,
    );
  });

  it("keeps the balance consistent under concurrent deductions", async () => {
    const before = await jowar();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => move(-40, `alert-concurrent-${i}`)));
    const applied = results.filter((r) => r.status === "fulfilled").length;
    expect(applied).toBe(Math.min(8, Math.floor(before / 40)));
    expect(await jowar()).toBe(before - applied * 40);
  });
});

describe("supporting documents in storage", () => {
  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role; reset request.jwt.claim.sub;");
    }
  }

  it("lets a user upload only into their own folder", async () => {
    const owner = await createUser("p2-doc-owner@example.test", { account_type: "shop_admin" });
    await asUser(owner, async () => {
      await db.query("insert into storage.objects (bucket_id, name) values ('shop-documents', $1)", [
        `${owner}/licence.pdf`,
      ]);
      await rejects(
        "insert into storage.objects (bucket_id, name) values ('shop-documents', $1)",
        ["00000000-0000-4000-8000-000000000000/licence.pdf"],
        /row-level security/,
      );
    });
  });

  it("shows a recorded document to its owner and the reviewing warehouse only", async () => {
    const owner = await createUser("p2-doc-owner-2@example.test", { account_type: "shop_admin" });
    const shop = await submit(owner, "DEMO-FPS-MYS-0320");
    const path = `${owner}/licence-2.pdf`;
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('shop-documents', $1, $2)", [path, owner]);
    await db.query(
      `insert into public.shop_documents (shop_id, storage_path, file_name, content_type, size_bytes, uploaded_by)
       values ($1, $2, 'licence.pdf', 'application/pdf', 1000, $3)`,
      [shop.id, path, owner],
    );
    const mysAdmin = await provision("p2-doc-mys@example.test", "DEMO-WH-MYS");
    const dwdAdmin = await provision("p2-doc-dwd@example.test", "DEMO-WH-DWD");
    const stranger = await createUser("p2-doc-stranger@example.test");
    const visible = (user: string) =>
      asUser(user, async () => (await db.query("select name from storage.objects where name = $1", [path])).rows.length);

    expect(await visible(owner)).toBe(1);
    expect(await visible(mysAdmin)).toBe(1);
    expect(await visible(dwdAdmin)).toBe(0);
    expect(await visible(stranger)).toBe(0);
  });

  it("keeps Phase 2 tables and functions closed to browser roles", async () => {
    const user = await createUser("p2-rls@example.test");
    await asUser(user, async () => {
      await rejects("select * from public.stock_alerts", [], DENIED);
      await rejects("select * from public.shop_reviews", [], DENIED);
      await rejects("select * from public.shop_documents", [], DENIED);
      await rejects("select public.review_shop(gen_random_uuid(), $1, 'approved', 'self approval')", [user], DENIED);
      await rejects("select public.set_low_stock_threshold(gen_random_uuid(), 'RICE', 1, $1)", [user], DENIED);
    });
  });
});
