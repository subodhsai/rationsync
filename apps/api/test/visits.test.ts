import type { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp, createTestDb, createUser } from "./test-db.js";

// Phase 4 end to end through the real Express app, migrations and database functions.
// PGlite runs one connection, so "concurrent" requests here are interleaved, not parallel:
// they prove the capacity and decide-once logic, not Postgres row locking under real load.

const SHOP_A = "0d9a0000-0000-4000-b000-000000000101"; // seed cards 104, 108, 112... belong here
const SHOP_B = "0d9a0000-0000-4000-b000-000000000102"; // seed cards 101, 105...

let pg: PGlite;
let app: ReturnType<typeof createTestApp>["app"];
let bearer: ReturnType<typeof createTestApp>["bearer"];
const users: Record<string, string> = {};

const auth = async (user: string) => ({ Authorization: await bearer(users[user]!) });
const get = async (path: string, user: string) => request(app).get(path).set(await auth(user));
const post = async (path: string, user: string, body: object = {}) => request(app).post(path).set(await auth(user)).send(body);
const patch = async (path: string, user: string, body: object) => request(app).patch(path).set(await auth(user)).send(body);
const scalar = async <T>(sql: string, params: unknown[] = []) => (await pg.query<{ v: T }>(sql, params)).rows[0]?.v as T;

/** A slot at a shop, relative to now: starts after `startMinutes`, lasts an hour. */
async function slot(shopId: string, startMinutes: number, capacity = 15, walkInReserve = 3) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.appointment_slots (shop_id, starts_at, ends_at, capacity, walk_in_reserve)
     values ($1, date_trunc('minute', now()) + make_interval(mins => $2), date_trunc('minute', now()) + make_interval(mins => $2 + 60), $3, $4)
     returning id`,
    [shopId, startMinutes, capacity, walkInReserve],
  );
  return rows[0]!.id;
}

async function household(name: string, card: number) {
  users[name] = await createUser(pg, `${name}@visits.test`, { full_name: `Demo ${name}` });
  const res = await post("/api/v1/beneficiary/card-link", name, {
    cardNumber: `DEMO-000${card}`,
    headOfFamily: `Demo household ${card}`,
  });
  expect(res.status).toBe(201);
}

const book = async (user: string, slotId: string) => post("/api/v1/beneficiary/bookings", user, { slotId });
const tokenOf = async (user: string, bookingId: string) =>
  (await get(`/api/v1/beneficiary/bookings/${bookingId}`, user)).body.booking.token as string;
const kinds = async (user: string) =>
  (await pg.query<{ kind: string }>("select kind from public.notifications where user_id = $1", [users[user]])).rows.map((r) => r.kind);

beforeAll(async () => {
  pg = await createTestDb();
  ({ app, bearer } = createTestApp(pg));
  for (const [name, shop] of [
    ["shopA", SHOP_A],
    ["shopB", SHOP_B],
  ] as const) {
    users[name] = await createUser(pg, `${name}@visits.test`, { account_type: "shop_admin", full_name: `Demo ${name}` });
    await pg.query("update public.shops set owner_id = $1 where id = $2", [users[name], shop]);
  }
}, 60_000);

describe("demo card linking", () => {
  beforeAll(async () => {
    users.hh1 = await createUser(pg, "hh1@visits.test", { full_name: "Demo hh1" });
    users.hh2 = await createUser(pg, "hh2@visits.test");
    users.hh3 = await createUser(pg, "hh3@visits.test");
  });

  it("refuses real-looking card numbers before any lookup", async () => {
    const res = await post("/api/v1/beneficiary/card-link", "hh1", { cardNumber: "KA1234567890", headOfFamily: "Someone" });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("cardNumber");
  });

  it("gives the same answer for a wrong name and for a card that is not available", async () => {
    const wrong = await post("/api/v1/beneficiary/card-link", "hh1", { cardNumber: "DEMO-000104", headOfFamily: "Not the head" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toMatchObject({ code: "card_not_verified", message: "No demo card matches those details." });
  });

  it("links a matching demo card and shows only the masked number", async () => {
    const res = await post("/api/v1/beneficiary/card-link", "hh1", { cardNumber: "demo-000104", headOfFamily: " demo household 104 " });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ card: { cardNumber: "•••••••••04", memberCount: expect.any(Number) }, shop: { fpsId: "DEMO-FPS-MYS-0101" } });
    expect(JSON.stringify(res.body)).not.toContain("DEMO-000104");
  });

  it("refuses a second card, and someone else linking the same card", async () => {
    expect((await post("/api/v1/beneficiary/card-link", "hh1", { cardNumber: "DEMO-000108", headOfFamily: "Demo household 108" })).body.error.code).toBe("card_already_linked");
    const taken = await post("/api/v1/beneficiary/card-link", "hh2", { cardNumber: "DEMO-000104", headOfFamily: "Demo household 104" });
    expect(taken.body.error).toMatchObject({ code: "card_not_verified", message: "No demo card matches those details." });
  });

  it("locks linking after five failed attempts in an hour", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post("/api/v1/beneficiary/card-link", "hh3", { cardNumber: "DEMO-000112", headOfFamily: `Guess ${i}` })).status).toBe(422);
    }
    const locked = await post("/api/v1/beneficiary/card-link", "hh3", { cardNumber: "DEMO-000112", headOfFamily: "Demo household 112" });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("too_many_attempts");
    expect(await scalar("select count(*)::int as v from public.beneficiary_cards where user_id = $1", [users.hh3])).toBe(0);
  });

  it("keeps household routes away from other roles", async () => {
    expect((await get("/api/v1/beneficiary/overview", "shopA")).status).toBe(403);
    expect((await post("/api/v1/shop/check-ins", "hh1", { code: "AAAAAAAAAA" })).status).toBe(403);
  });

  it("updates name and language but never the role", async () => {
    const res = await patch("/api/v1/beneficiary/profile", "hh1", { fullName: "Demo Lakshmi", preferredLanguage: "kn", role: "warehouse_admin" });
    expect(res.body.profile).toEqual({ fullName: "Demo Lakshmi", preferredLanguage: "kn" });
    expect(await scalar("select role::text as v from public.profiles where id = $1", [users.hh1])).toBe("beneficiary");
  });
});

describe("booking", () => {
  let bookingId: string;
  let firstSlot: string;

  it("asks for a linked card before showing slots", async () => {
    expect((await get("/api/v1/beneficiary/slots", "hh2")).body.error.code).toBe("card_not_linked");
  });

  it("lists bookable places at the linked shop only, after walk-in places", async () => {
    const res = await get("/api/v1/beneficiary/slots", "hh1");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toMatchObject({ capacity: 15, walkInReserve: 3, booked: 0, remaining: 12, status: "open" });
    const shops = await pg.query<{ shop_id: string }>("select distinct shop_id from public.appointment_slots where id = any($1::uuid[])", [
      res.body.items.map((s: { id: string }) => s.id),
    ]);
    expect(shops.rows.map((r) => r.shop_id)).toEqual([SHOP_A]);
    firstSlot = res.body.items[0].id;
  });

  it("books once, answers a repeated tap with the same booking, and notifies", async () => {
    const res = await book("hh1", firstSlot);
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: "booked", code: expect.stringMatching(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{2}$/) });
    expect(res.body.booking.token).toMatch(/^[0-9a-f]{32}$/);
    bookingId = res.body.booking.id;
    expect((await book("hh1", firstSlot)).body.booking.id).toBe(bookingId);
    expect(await kinds("hh1")).toContain("booking.confirmed");
  });

  it("allows one active booking per household", async () => {
    const other = await slot(SHOP_A, 60 * 30);
    const res = await book("hh1", other);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("active_booking_exists");
  });

  it("hides one household's booking and token from another", async () => {
    await household("hh4", 108);
    expect((await get(`/api/v1/beneficiary/bookings/${bookingId}`, "hh4")).status).toBe(404);
    expect((await post(`/api/v1/beneficiary/bookings/${bookingId}/cancel`, "hh4")).status).toBe(404);
  });

  it("never fills more bookable places than exist, however the requests interleave", async () => {
    // Capacity 3 with 1 walk-in place: two bookable.
    const tight = await slot(SHOP_A, 60 * 40, 3, 1);
    await household("hh5", 116);
    await household("hh6", 120);
    const results = await Promise.all(["hh4", "hh5", "hh6"].map((u) => book(u, tight)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect(await scalar("select booked_count as v from public.appointment_slots where id = $1", [tight])).toBe(2);
  });

  it("refuses a paused slot and cancels bookings when the shop closes one", async () => {
    const tight = await scalar<string>("select id as v from public.appointment_slots where capacity = 3 and shop_id = $1", [SHOP_A]);
    const extra = await slot(SHOP_A, 60 * 50);
    await household("hh7", 124);
    expect((await post(`/api/v1/shop/slots/${extra}/status`, "shopA", { status: "paused" })).status).toBe(200);
    expect((await book("hh7", extra)).body.error.code).toBe("slot_unavailable");
    expect((await post(`/api/v1/shop/slots/${extra}/status`, "shopB", { status: "open" })).status).toBe(404);

    expect((await post(`/api/v1/shop/slots/${tight}/status`, "shopA", { status: "closed" })).status).toBe(400);
    expect((await post(`/api/v1/shop/slots/${tight}/status`, "shopA", { status: "closed", reason: "Stock delivery at that hour" })).status).toBe(200);
    expect(await scalar("select count(*)::int as v from public.bookings where slot_id = $1 and status = 'booked'", [tight])).toBe(0);
    expect(await kinds("hh5")).toContain("booking.cancelled_by_shop");
    expect((await post(`/api/v1/shop/slots/${tight}/status`, "shopA", { status: "open" })).body.error.code).toBe("slot_closed");
  });

  it("reschedules in one step, keeping the original when the new time is unavailable", async () => {
    const full = await slot(SHOP_A, 60 * 60, 2, 1);
    await household("hh8", 128);
    await book("hh8", full);
    expect((await post(`/api/v1/beneficiary/bookings/${bookingId}/reschedule`, "hh1", { slotId: full })).body.error.code).toBe("slot_unavailable");
    expect(await scalar("select status::text as v from public.bookings where id = $1", [bookingId])).toBe("booked");

    const later = await slot(SHOP_A, 60 * 70);
    const res = await post(`/api/v1/beneficiary/bookings/${bookingId}/reschedule`, "hh1", { slotId: later });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: "booked", rescheduledFrom: bookingId });
    expect(await scalar("select cancel_reason as v from public.bookings where id = $1", [bookingId])).toBe("Rescheduled");
    expect(await scalar("select booked_count as v from public.appointment_slots where id = $1", [firstSlot])).toBe(0);
    expect(await kinds("hh1")).toContain("booking.rescheduled");
    bookingId = res.body.booking.id;
  });

  it("cancels once and frees the place", async () => {
    const res = await post(`/api/v1/beneficiary/bookings/${bookingId}/cancel`, "hh1");
    expect(res.body.booking.status).toBe("cancelled");
    expect((await post(`/api/v1/beneficiary/bookings/${bookingId}/cancel`, "hh1")).body.error.code).toBe("booking_not_active");
    const history = (await get("/api/v1/beneficiary/bookings?scope=past", "hh1")).body.items;
    expect(history.map((b: { status: string }) => b.status)).toEqual(expect.arrayContaining(["cancelled", "cancelled"]));
    expect(history.every((b: { token?: string }) => b.token === undefined)).toBe(true);
  });

  it("reminds a household once about a visit within a day", async () => {
    const soon = await slot(SHOP_A, 120);
    await book("hh1", soon);
    await get("/api/v1/beneficiary/overview", "hh1");
    await get("/api/v1/beneficiary/overview", "hh1");
    expect((await kinds("hh1")).filter((k) => k === "booking.reminder")).toHaveLength(1);
  });
});

describe("schedule", () => {
  const window = { weekday: 1, startTime: "09:00", endTime: "11:00", slotMinutes: 60, capacity: 20, walkInReserve: 5 };

  it("refuses overlapping windows and saves a valid week", async () => {
    expect((await post("/api/v1/shop/booking-schedule", "shopB", { windows: [window, { ...window, startTime: "10:00" , endTime: "12:00" }] })).status).toBe(400);
    const week = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ ...window, weekday, startTime: "06:00", endTime: "23:00" }));
    expect((await post("/api/v1/shop/booking-schedule", "shopB", { windows: week })).status).toBe(200);
    expect((await get("/api/v1/shop/booking-schedule", "shopB")).body.windows).toHaveLength(7);
  });

  it("publishes slots from the schedule once", async () => {
    const first = await post("/api/v1/shop/slots/publish", "shopB", { days: 3 });
    expect(first.body.created).toBeGreaterThan(0);
    expect((await post("/api/v1/shop/slots/publish", "shopB", { days: 3 })).body.created).toBe(0);
    const slots = (await get("/api/v1/shop/slots?days=3", "shopB")).body.items;
    expect(slots.some((s: { capacity: number; walkInReserve: number }) => s.capacity === 20 && s.walkInReserve === 5)).toBe(true);
  });
});

describe("check-in and queue", () => {
  let token: string;
  let code: string;

  beforeAll(async () => {
    const now = await slot(SHOP_A, 30);
    await household("hh9", 132);
    const booked = (await book("hh9", now)).body.booking;
    token = await tokenOf("hh9", booked.id);
    code = booked.code;
  });

  it("refuses check-in at a shop the booking is not for", async () => {
    const res = await post("/api/v1/shop/check-ins", "shopB", { token });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("invalid_token");
  });

  it("checks in once by QR token; a repeat returns the same queue entry", async () => {
    const first = await post("/api/v1/shop/check-ins", "shopA", { token });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ alreadyCheckedIn: false, entry: { number: 1, status: "waiting", kind: "booking" } });
    const again = await post("/api/v1/shop/check-ins", "shopA", { code });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alreadyCheckedIn: true, entry: { id: first.body.entry.id } });
    expect(await scalar("select count(*)::int as v from public.queue_entries where shop_id = $1", [SHOP_A])).toBe(1);
  });

  it("explains cancelled, early, expired and unknown codes", async () => {
    const early = await slot(SHOP_A, 60 * 5);
    await household("hh10", 136);
    const e = (await book("hh10", early)).body.booking;
    expect((await post("/api/v1/shop/check-ins", "shopA", { code: e.code })).body.error.code).toBe("too_early");

    await pg.query("update public.appointment_slots set starts_at = now() - interval '4 hours', ends_at = now() - interval '3 hours' where id = $1", [early]);
    expect((await post("/api/v1/shop/check-ins", "shopA", { code: e.code })).body.error.code).toBe("booking_expired");

    await pg.query("update public.appointment_slots set starts_at = now() + interval '20 minutes', ends_at = now() + interval '80 minutes' where id = $1", [early]);
    await post(`/api/v1/beneficiary/bookings/${e.id}/cancel`, "hh10");
    expect((await post("/api/v1/shop/check-ins", "shopA", { code: e.code })).body.error.code).toBe("booking_cancelled");
    expect((await post("/api/v1/shop/check-ins", "shopA", { code: "0000-0000-00" })).body.error.code).toBe("invalid_token");
    expect((await post("/api/v1/shop/check-ins", "shopA", { token: "nonsense" })).status).toBe(400);
  });

  it("shows the household its number and who is being served", async () => {
    const overview = (await get("/api/v1/beneficiary/overview", "hh9")).body;
    expect(overview.upcomingBooking).toMatchObject({
      status: "checked_in",
      queue: { number: 1, status: "waiting", nowServing: null, peopleAhead: 0, estimate: { status: "insufficient" } },
    });
    expect(overview.upcomingBooking.token).toBeUndefined();
  });

  it("runs the queue: walk-ins, one at the counter, served and not present", async () => {
    const walkIn = await post("/api/v1/shop/queue/walk-ins", "shopA", { note: "Assisted by staff" });
    expect(walkIn.body.entry).toMatchObject({ number: 2, kind: "walk_in", status: "waiting" });

    const called = await post("/api/v1/shop/queue/call-next", "shopA");
    expect(called.body.entry).toMatchObject({ number: 1, status: "serving" });
    expect((await post("/api/v1/shop/queue/call-next", "shopA")).body.error.code).toBe("someone_serving");
    expect((await get("/api/v1/beneficiary/overview", "hh9")).body.upcomingBooking.queue).toMatchObject({ status: "serving", nowServing: 1 });

    const served = await post(`/api/v1/shop/queue/${called.body.entry.id}/finish`, "shopA", { outcome: "served" });
    expect(served.body.entry.status).toBe("served");
    expect((await post(`/api/v1/shop/queue/${called.body.entry.id}/finish`, "shopA", { outcome: "no_show" })).body.error.code).toBe("invalid_transition");

    const next = await post("/api/v1/shop/queue/call-next", "shopA");
    expect(next.body.entry.number).toBe(2);
    await post(`/api/v1/shop/queue/${next.body.entry.id}/finish`, "shopA", { outcome: "no_show" });
    expect((await post("/api/v1/shop/queue/call-next", "shopA")).body.error.code).toBe("queue_empty");
    expect((await post(`/api/v1/shop/queue/${next.body.entry.id}/finish`, "shopB", { outcome: "served" })).status).toBe(404);

    expect(await kinds("hh9")).toEqual(expect.arrayContaining(["queue.checked_in", "queue.called", "queue.served"]));
  });

  it("leaves shop stock untouched by check-in and service", async () => {
    expect(await scalar("select count(*)::int as v from public.stock_movements where actor_id = $1", [users.shopA])).toBe(0);
  });

  it("estimates waits only from enough observed visits", async () => {
    expect((await get("/api/v1/shop/queue", "shopA")).body.queue.estimate.status).toBe("insufficient");
    await pg.query(
      `insert into public.queue_entries (shop_id, service_date, number, status, checked_in_at, called_at, finished_at, created_by)
       select $1, public.today_ist() - 1, n, 'served', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day' + make_interval(secs => 240), $2
         from generate_series(1, 5) n`,
      [SHOP_A, users.shopA],
    );
    await post("/api/v1/shop/queue/walk-ins", "shopA", {});
    const queue = (await get("/api/v1/shop/queue", "shopA")).body.queue;
    expect(queue.estimate).toMatchObject({ status: "estimate", minutes: 4 });
    expect(queue.waiting).toHaveLength(1);
  });

  it("marks a booked household not attended only after its time starts", async () => {
    const future = await slot(SHOP_A, 60 * 80);
    await household("hh11", 140);
    const b = (await book("hh11", future)).body.booking;
    expect((await post(`/api/v1/shop/bookings/${b.id}/no-show`, "shopA")).body.error.code).toBe("booking_not_active");
    await pg.query("update public.appointment_slots set starts_at = now() - interval '10 minutes', ends_at = now() + interval '50 minutes' where id = $1", [future]);
    expect((await post(`/api/v1/shop/bookings/${b.id}/no-show`, "shopB")).status).toBe(409);
    expect((await post(`/api/v1/shop/bookings/${b.id}/no-show`, "shopA")).status).toBe(200);
    expect(await kinds("hh11")).toContain("booking.no_show");
  });

  it("guards queue integrity in the database", async () => {
    await expect(
      pg.query(
        `insert into public.queue_entries (shop_id, service_date, number, created_by) values ($1, public.today_ist(), 1, $2)`,
        [SHOP_A, users.shopA],
      ),
    ).rejects.toThrow(/queue_entries_shop_id_service_date_number_key/);
    const entry = await scalar<string>("select id as v from public.queue_entries where status = 'served' limit 1");
    await expect(pg.query("update public.queue_entries set status = 'waiting' where id = $1", [entry])).rejects.toMatchObject({ hint: "invalid_transition" });
  });

  it("summarises attendance from records", async () => {
    const summary = (await get("/api/v1/shop/attendance", "shopA")).body.summary;
    // Two real walk-ins plus the five served visits inserted for the estimate test, which have no booking.
    expect(summary).toMatchObject({ days: 30, walkIns: 7, served: 6, calledNotPresent: 1, serviceSamples: 6, medianServiceMinutes: 4 });
    expect(summary.notAttended).toBeGreaterThanOrEqual(1);
  });

  it("keeps an audit trail of every visit step", async () => {
    const actions = (await pg.query<{ action: string }>("select distinct action from public.audit_log")).rows.map((r) => r.action);
    for (const action of [
      "card.linked", "booking.created", "booking.cancelled", "booking.rescheduled", "booking.checked_in", "booking.no_show",
      "slot.paused", "slot.closed", "schedule.saved", "slots.published", "queue.walk_in", "queue.called", "queue.served", "queue.no_show",
    ]) {
      expect(actions).toContain(action);
    }
  });
});
