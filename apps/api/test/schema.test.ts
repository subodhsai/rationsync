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
