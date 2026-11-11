import type { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp, createTestDb, createUser } from "./test-db.js";

// Phase 3 end to end: requests, reservations, shipments, receipt and reconciliation, through
// the real Express app, migrations and database functions.

const MYS = "0d9a0000-0000-4000-a000-000000000001";
const DWD = "0d9a0000-0000-4000-a000-000000000002";
const tomorrow = new Date(Date.now() + (5.5 + 24) * 3600_000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() + (5.5 - 24) * 3600_000).toISOString().slice(0, 10);

let pg: PGlite;
let app: ReturnType<typeof createTestApp>["app"];
let bearer: ReturnType<typeof createTestApp>["bearer"];
const users: Record<string, string> = {};
const shops: Record<string, string> = {};
let keyCounter = 0;
const newKey = () => `test-key-${++keyCounter}-${Date.now()}`;

const auth = async (user: string) => ({ Authorization: await bearer(users[user]!) });
const get = async (path: string, user: string) => request(app).get(path).set(await auth(user));
const post = async (path: string, user: string, body: object = {}, key?: string) =>
  request(app)
    .post(path)
    .set({ ...(await auth(user)), ...(key ? { "Idempotency-Key": key } : {}) })
    .send(body);
const patch = async (path: string, user: string, body: object) => request(app).patch(path).set(await auth(user)).send(body);

const scalar = async <T>(sql: string, params: unknown[] = []) => (await pg.query<{ v: T }>(sql, params)).rows[0]?.v as T;
const warehouseStock = async (code: string) =>
  (
    await pg.query<{ on_hand: number; reserved: number }>(
      "select quantity_on_hand::float8 as on_hand, quantity_reserved::float8 as reserved from public.warehouse_inventory where warehouse_id = $1 and commodity_code = $2",
      [MYS, code],
    )
  ).rows[0]!;
const shopStock = (shop: string, code: string) =>
  scalar<number>("select quantity::float8 as v from public.shop_inventory where shop_id = $1 and commodity_code = $2", [shops[shop], code]);

async function approvedShop(name: string, fpsId: string, warehouseId = MYS) {
  users[name] = await createUser(pg, `${name}@supply.test`, { account_type: "shop_admin", full_name: `Demo ${name}` });
  const res = await post("/api/v1/registration", name, {
    fpsId,
    name: `Demo FPS ${name}`,
    district: warehouseId === MYS ? "Mysuru" : "Dharwad",
    taluk: "Demo taluk",
    address: "1st Main, Demo Layout, Demo town",
    pinCode: warehouseId === MYS ? "570002" : "580021",
    contactPhone: "+91 98450 00000",
    warehouseId,
  });
  shops[name] = res.body.application.id;
  const admin = warehouseId === MYS ? "mys" : "dwd";
  expect((await post(`/api/v1/warehouse/shops/${shops[name]}/review`, admin, { decision: "approved", reason: "Licence checked" })).status).toBe(200);
}

const requestBody = (overrides: object = {}) => ({
  commodityCode: "RICE",
  quantity: 120,
  reason: "Stock below threshold before the next distribution day",
  priority: "normal",
  ...overrides,
});

beforeAll(async () => {
  pg = await createTestDb();
  ({ app, bearer } = createTestApp(pg));
  for (const [name, code] of [
    ["mys", "DEMO-WH-MYS"],
    ["dwd", "DEMO-WH-DWD"],
  ] as const) {
    users[name] = await createUser(pg, `${name}@supply.test`, { full_name: `Demo ${name} admin` });
    await pg.query("select public.provision_warehouse_admin($1, $2)", [`${name}@supply.test`, code]);
  }
  await approvedShop("a", "DEMO-FPS-MYS-0901");
  await approvedShop("b", "DEMO-FPS-MYS-0902");
  await approvedShop("c", "DEMO-FPS-MYS-0903");
  // Shop A holds 80 kg of rice against a 100 kg threshold: the brief's example.
  await post("/api/v1/shop/movements", "a", { kind: "opening_balance", commodityCode: "RICE", quantity: 80, reason: "Opening" }, newKey());
  await patch("/api/v1/shop/inventory/RICE/threshold", "a", { lowStockThreshold: 100 });
}, 60_000);

describe("replenishment requests", () => {
  let requestId: string;
  const key = "request-key-0001";

  it("suggests filling to twice the threshold when stock is low", async () => {
    const res = await get("/api/v1/shop/suggestions", "a");
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      commodityCode: "RICE",
      onHand: 80,
      threshold: 100,
      target: 200,
      targetIsDefault: true,
      suggestedQuantity: 120,
      openRequest: null,
      forecast: { status: "insufficient" },
      recommendation: { priority: "normal" },
    });
  });

  it("validates input and requires an idempotency key", async () => {
    const invalid = await post("/api/v1/shop/requests", "a", requestBody({ quantity: -5, priority: "asap" }), newKey());
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["priority", "quantity"]);
    expect((await post("/api/v1/shop/requests", "a", requestBody())).body.error.code).toBe("idempotency_key_required");
  });

  it("creates a pending request with a snapshot of current stock", async () => {
    const res = await post("/api/v1/shop/requests", "a", requestBody({ suggestedQuantity: 120 }), key);
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({
      reference: expect.stringMatching(/^RQ-\d{5}$/),
      status: "pending",
      requestedQuantity: 120,
      stockAtRequest: 80,
      suggestedQuantity: 120,
      warehouseId: MYS,
    });
    expect(res.body.request.recommendation).toBeUndefined();
    requestId = res.body.request.id;
  });

  it("answers a repeated submission with the same request", async () => {
    const res = await post("/api/v1/shop/requests", "a", requestBody({ suggestedQuantity: 120 }), key);
    expect(res.status).toBe(201);
    expect(res.body.request.id).toBe(requestId);
    const reused = await post("/api/v1/shop/requests", "a", requestBody({ quantity: 999 }), key);
    expect(reused.body.error.code).toBe("idempotency_key_reused");
  });

  it("refuses a second open request for the same commodity", async () => {
    const res = await post("/api/v1/shop/requests", "a", requestBody(), newKey());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("request_exists");
  });

  it("shows the open request in place of a new suggestion", async () => {
    const res = await get("/api/v1/shop/suggestions", "a");
    expect(res.body.items[0]).toMatchObject({ suggestedQuantity: 0, openRequest: { id: requestId, status: "pending" } });
  });

  it("notifies the supplying warehouse in the app", async () => {
    const res = await get("/api/v1/notifications", "mys");
    expect(res.body.items.map((n: { kind: string }) => n.kind)).toContain("request.submitted");
    expect((await get("/api/v1/notifications", "dwd")).body.items.map((n: { kind: string }) => n.kind)).not.toContain("request.submitted");
  });

  it("hides the request from other warehouses and from other shops", async () => {
    expect((await get(`/api/v1/warehouse/requests/${requestId}`, "dwd")).status).toBe(404);
    expect((await post(`/api/v1/warehouse/requests/${requestId}/decision`, "dwd", { decision: "approved", approvedQuantity: 1, reason: "Mine now" })).status).toBe(404);
    expect((await get(`/api/v1/shop/requests/${requestId}`, "b")).status).toBe(404);
    expect((await get("/api/v1/warehouse/requests?status=all", "dwd")).body.total).toBe(0);
  });

  it("does not let a shop administrator approve its own request", async () => {
    const res = await post(`/api/v1/warehouse/requests/${requestId}/decision`, "a", { decision: "approved", approvedQuantity: 120, reason: "Self" });
    expect(res.status).toBe(403);
    expect(await scalar("select status::text as v from public.replenishment_requests where id = $1", [requestId])).toBe("pending");
  });

  it("lets the warehouse inspect stock before deciding", async () => {
    const res = await get(`/api/v1/warehouse/requests/${requestId}`, "mys");
    expect(res.body.request).toMatchObject({
      shopStock: { onHand: 80, threshold: 100 },
      warehouseStock: { onHand: 18000, reserved: 0, available: 18000 },
      recommendation: { priority: "normal" },
    });
  });

  it("approves, reserves warehouse stock, and adds nothing to the shop", async () => {
    const res = await post(`/api/v1/warehouse/requests/${requestId}/decision`, "mys", {
      decision: "approved",
      approvedQuantity: 120,
      reason: "Stock available",
    });
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ status: "approved", approvedQuantity: 120, decidedByName: "Demo mys admin" });
    expect(await warehouseStock("RICE")).toEqual({ on_hand: 18000, reserved: 120 });
    expect(await shopStock("a", "RICE")).toBe(80);
  });

  it("decides a request only once", async () => {
    const res = await post(`/api/v1/warehouse/requests/${requestId}/decision`, "mys", { decision: "rejected", reason: "Changed my mind" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("already_decided");
  });

  it("lets a shop cancel only while pending", async () => {
    expect((await post(`/api/v1/shop/requests/${requestId}/cancel`, "a")).body.error.code).toBe("request_not_pending");
    const sugar = await post("/api/v1/shop/requests", "a", requestBody({ commodityCode: "SUGAR", quantity: 40 }), newKey());
    const cancelled = await post(`/api/v1/shop/requests/${sugar.body.request.id}/cancel`, "a");
    expect(cancelled.body.request.status).toBe("cancelled");
  });

  it("records a rejection with its reason", async () => {
    const wheat = await post("/api/v1/shop/requests", "b", requestBody({ commodityCode: "WHEAT", quantity: 60 }), newKey());
    const id = wheat.body.request.id;
    expect((await post(`/api/v1/warehouse/requests/${id}/decision`, "mys", { decision: "rejected", reason: "" })).status).toBe(400);
    const res = await post(`/api/v1/warehouse/requests/${id}/decision`, "mys", { decision: "rejected", reason: "Wheat is not on this month's allocation" });
    expect(res.body.request).toMatchObject({ status: "rejected", approvedQuantity: null, decisionReason: "Wheat is not on this month's allocation" });
  });
});

describe("warehouse stock limits", () => {
  let jowarA: string;

  it("refuses to reserve more than the warehouse has, and allows a partial approval", async () => {
    // The Mysuru warehouse holds 600 kg of jowar.
    jowarA = (await post("/api/v1/shop/requests", "a", requestBody({ commodityCode: "JOWAR", quantity: 700 }), newKey())).body.request.id;
    const tooMuch = await post(`/api/v1/warehouse/requests/${jowarA}/decision`, "mys", { decision: "approved", approvedQuantity: 700, reason: "All of it" });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("insufficient_warehouse_stock");
    expect(await scalar("select status::text as v from public.replenishment_requests where id = $1", [jowarA])).toBe("pending");

    const partial = await post(`/api/v1/warehouse/requests/${jowarA}/decision`, "mys", {
      decision: "approved",
      approvedQuantity: 500,
      reason: "Partial: keeping a buffer for other shops",
    });
    expect(partial.body.request).toMatchObject({ status: "approved", requestedQuantity: 700, approvedQuantity: 500 });
    expect(await warehouseStock("JOWAR")).toEqual({ on_hand: 600, reserved: 500 });
  });

  it("never approves more than was requested", async () => {
    const id = (await post("/api/v1/shop/requests", "c", requestBody({ commodityCode: "RAGI", quantity: 10 }), newKey())).body.request.id;
    const res = await post(`/api/v1/warehouse/requests/${id}/decision`, "mys", { decision: "approved", approvedQuantity: 11, reason: "Extra" });
    expect(res.body.error.code).toBe("invalid_quantity");
  });

  it("lets only one of two concurrent approvals reserve the last stock", async () => {
    // 100 kg of jowar is unreserved; both requests want 80.
    const [b, c] = await Promise.all(
      ["b", "c"].map(async (s) => (await post("/api/v1/shop/requests", s, requestBody({ commodityCode: "JOWAR", quantity: 80 }), newKey())).body.request.id),
    );
    const results = await Promise.all(
      [b, c].map((id) => post(`/api/v1/warehouse/requests/${id}/decision`, "mys", { decision: "approved", approvedQuantity: 80, reason: "Race" })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await warehouseStock("JOWAR")).toEqual({ on_hand: 600, reserved: 580 });
  });

  it("reports reserved and available stock", async () => {
    const res = await get("/api/v1/warehouse/inventory", "mys");
    expect(res.body.items.find((i: { commodityCode: string }) => i.commodityCode === "JOWAR")).toMatchObject({
      onHand: 600,
      reserved: 580,
      available: 20,
      inTransit: 0,
    });
    expect((await get("/api/v1/warehouse/inventory", "dwd")).body.items.every((i: { warehouseId: string }) => i.warehouseId === DWD)).toBe(true);
  });

  it("records warehouse receipts and refuses adjustments into reserved stock", async () => {
    const receipt = await post("/api/v1/warehouse/movements", "mys",
      { warehouseId: MYS, kind: "receipt", commodityCode: "SUGAR", quantity: 100, reason: "Lorry from district depot", reference: "DEMO-CHALLAN-11" }, newKey());
    expect(receipt.status).toBe(201);
    expect(receipt.body.item).toMatchObject({ onHand: 1000 });

    const intoReserved = await post("/api/v1/warehouse/movements", "mys",
      { warehouseId: MYS, kind: "adjustment", direction: "decrease", commodityCode: "JOWAR", quantity: 30, reason: "Damaged bags" }, newKey());
    expect(intoReserved.body.error.code).toBe("insufficient_warehouse_stock");

    const opening = await post("/api/v1/warehouse/movements", "mys",
      { warehouseId: MYS, kind: "opening_balance", commodityCode: "RICE", quantity: 5, reason: "Again" }, newKey());
    expect(opening.body.error.code).toBe("opening_balance_exists");

    const foreign = await post("/api/v1/warehouse/movements", "mys",
      { warehouseId: DWD, kind: "receipt", commodityCode: "RICE", quantity: 5, reason: "Not mine" }, newKey());
    expect(foreign.status).toBe(404);
  });
});

describe("shipments", () => {
  let riceRequest: string;
  let jowarRequest: string;
  let shipmentId: string;
  const shipmentKey = "shipment-key-0001";

  beforeAll(async () => {
    const approved = (await get(`/api/v1/warehouse/requests?status=approved&shopId=${shops.a}`, "mys")).body.items;
    riceRequest = approved.find((r: { commodityCode: string }) => r.commodityCode === "RICE").id;
    jowarRequest = approved.find((r: { commodityCode: string }) => r.commodityCode === "JOWAR").id;
  });

  it("refuses requests that are not approved or belong to another shop", async () => {
    const pendingRagi = (await get("/api/v1/warehouse/requests?status=pending&commodity=RAGI", "mys")).body.items[0].id;
    const notApproved = await post("/api/v1/warehouse/shipments", "mys",
      { shopId: shops.a, requestIds: [riceRequest, pendingRagi], expectedDeliveryDate: tomorrow }, newKey());
    expect(notApproved.body.error.code).toBe("request_not_shippable");
    const past = await post("/api/v1/warehouse/shipments", "mys",
      { shopId: shops.a, requestIds: [riceRequest], expectedDeliveryDate: yesterday }, newKey());
    expect(past.body.error.code).toBe("invalid_date");
    const foreign = await post("/api/v1/warehouse/shipments", "dwd",
      { shopId: shops.a, requestIds: [riceRequest], expectedDeliveryDate: tomorrow }, newKey());
    expect(foreign.status).toBe(404);
  });

  it("prepares a shipment from approved requests, once", async () => {
    const body = { shopId: shops.a, requestIds: [riceRequest, jowarRequest], expectedDeliveryDate: tomorrow, notes: "Two lots" };
    const res = await post("/api/v1/warehouse/shipments", "mys", body, shipmentKey);
    expect(res.status).toBe(201);
    expect(res.body.shipment).toMatchObject({ reference: expect.stringMatching(/^SH-\d{5}$/), status: "preparing", expectedDeliveryDate: tomorrow });
    expect(res.body.shipment.detailItems.map((i: { quantity: number }) => i.quantity)).toEqual([120, 500]);
    shipmentId = res.body.shipment.id;

    expect((await post("/api/v1/warehouse/shipments", "mys", body, shipmentKey)).body.shipment.id).toBe(shipmentId);
    expect((await post("/api/v1/warehouse/shipments", "mys", body, newKey())).body.error.code).toBe("request_not_shippable");
  });

  it("keeps a shipment being prepared out of the shop's view", async () => {
    expect((await get(`/api/v1/shop/shipments/${shipmentId}`, "a")).status).toBe(404);
  });

  it("dispatches once, moving reserved stock out of the warehouse", async () => {
    const res = await post(`/api/v1/warehouse/shipments/${shipmentId}/dispatch`, "mys");
    expect(res.status).toBe(200);
    expect(res.body.shipment).toMatchObject({ status: "dispatched", dispatchedByName: "Demo mys admin" });
    expect(await warehouseStock("RICE")).toEqual({ on_hand: 17880, reserved: 0 });
    expect(await warehouseStock("JOWAR")).toEqual({ on_hand: 100, reserved: 80 });
    expect(await shopStock("a", "RICE")).toBe(80);

    const again = await post(`/api/v1/warehouse/shipments/${shipmentId}/dispatch`, "mys");
    expect(again.body.error.code).toBe("already_dispatched");
    expect(await scalar("select count(*)::int as v from public.warehouse_stock_movements where shipment_id = $1", [shipmentId])).toBe(2);
    const stock = (await get("/api/v1/warehouse/inventory", "mys")).body.items;
    expect(stock.find((i: { commodityCode: string }) => i.commodityCode === "RICE").inTransit).toBe(120);
  });

  it("follows only the allowed status transitions", async () => {
    expect((await post(`/api/v1/warehouse/shipments/${shipmentId}/cancel`, "mys", { reason: "Too late" })).body.error.code).toBe("invalid_transition");
    expect((await post(`/api/v1/warehouse/shipments/${shipmentId}/in-transit`, "mys")).body.shipment.status).toBe("in_transit");
    await expect(pg.query("update public.shipments set status = 'preparing' where id = $1", [shipmentId])).rejects.toMatchObject({
      hint: "invalid_transition",
    });
  });

  it("requires a note when goods are missing or damaged", async () => {
    const items = (await get(`/api/v1/shop/shipments/${shipmentId}`, "a")).body.shipment.detailItems;
    const body = {
      items: items.map((i: { id: string; commodityCode: string; quantity: number }) =>
        i.commodityCode === "RICE"
          ? { itemId: i.id, receivedQuantity: 120, damagedQuantity: 0 }
          : { itemId: i.id, receivedQuantity: 450, damagedQuantity: 20 },
      ),
    };
    const noNote = await post(`/api/v1/shop/shipments/${shipmentId}/receive`, "a", body);
    expect(noNote.body.error.code).toBe("note_required");
    expect(await shopStock("a", "RICE")).toBe(80);

    const tooMuch = await post(`/api/v1/shop/shipments/${shipmentId}/receive`, "a", {
      items: body.items.map((i: { itemId: string }) => ({ ...i, receivedQuantity: 9999 })),
    });
    expect(tooMuch.body.error.code).toBe("receipt_exceeds_dispatch");
    expect((await post(`/api/v1/shop/shipments/${shipmentId}/receive`, "a", { items: body.items.slice(0, 1) })).body.error.code).toBe("items_mismatch");

    const res = await post(`/api/v1/shop/shipments/${shipmentId}/receive`, "a", { ...body, note: "Three bags short, two torn" });
    expect(res.status).toBe(200);
    expect(res.body.shipment).toMatchObject({ status: "partially_received", openDiscrepancies: 1, receiptNote: "Three bags short, two torn" });
    const jowar = res.body.shipment.detailItems.find((i: { commodityCode: string }) => i.commodityCode === "JOWAR");
    expect(jowar.discrepancy).toMatchObject({ shortageQuantity: 30, damagedQuantity: 20, status: "open" });
  });

  it("credits only what arrived in good condition", async () => {
    expect(await shopStock("a", "RICE")).toBe(200);
    expect(await shopStock("a", "JOWAR")).toBe(450);
    const statuses = (await get("/api/v1/shop/requests?status=closed", "a")).body.items.map((r: { commodityCode: string; status: string; receivedQuantity: number }) => [r.commodityCode, r.status, r.receivedQuantity]);
    expect(statuses).toEqual(expect.arrayContaining([["RICE", "fulfilled", 120], ["JOWAR", "partially_fulfilled", 450]]));
  });

  it("refuses a duplicate delivery confirmation", async () => {
    const items = (await get(`/api/v1/shop/shipments/${shipmentId}`, "a")).body.shipment.detailItems;
    const res = await post(`/api/v1/shop/shipments/${shipmentId}/receive`, "a", {
      items: items.map((i: { id: string }) => ({ itemId: i.id, receivedQuantity: 1, damagedQuantity: 0 })),
    });
    expect(res.body.error.code).toBe("already_received");
    expect(await shopStock("a", "RICE")).toBe(200);
    expect(await scalar("select count(*)::int as v from public.stock_movements where shop_id = $1 and kind = 'receipt'", [shops.a])).toBe(2);
  });

  it("resolves the low-stock alert once the receipt lifts stock above the threshold", async () => {
    const alerts = (await get("/api/v1/shop/alerts?status=all", "a")).body.items.filter((a: { commodityCode: string }) => a.commodityCode === "RICE");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].status).toBe("resolved");
  });

  it("reconciles requested, approved, dispatched and received quantities", async () => {
    const rows = (await get("/api/v1/warehouse/reconciliation?status=discrepancies", "mys")).body.items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      commodityName: "Jowar",
      requested: 700,
      approved: 500,
      dispatched: 500,
      received: 450,
      damaged: 20,
      shortage: 30,
      discrepancyStatus: "open",
    });
  });

  it("records a resolution once, without moving stock", async () => {
    const shipment = (await get(`/api/v1/warehouse/shipments/${shipmentId}`, "mys")).body.shipment;
    const discrepancy = shipment.detailItems.find((i: { discrepancy: unknown }) => i.discrepancy).discrepancy;
    expect((await post(`/api/v1/warehouse/discrepancies/${discrepancy.id}/resolve`, "dwd", { resolution: "Not mine" })).status).toBe(404);
    const res = await post(`/api/v1/warehouse/discrepancies/${discrepancy.id}/resolve`, "mys", { resolution: "Transporter liable; replacement on a new request" });
    expect(res.body.shipment.openDiscrepancies).toBe(0);
    expect((await post(`/api/v1/warehouse/discrepancies/${discrepancy.id}/resolve`, "mys", { resolution: "Again" })).body.error.code).toBe("already_resolved");
    expect(await shopStock("a", "JOWAR")).toBe(450);
  });

  it("keeps an audit trail of every step", async () => {
    const actions = (await pg.query<{ action: string }>("select action from public.audit_log order by id")).rows.map((r) => r.action);
    for (const action of [
      "request.submitted", "request.approved", "request.rejected", "request.cancelled",
      "shipment.created", "shipment.dispatched", "shipment.in_transit", "shipment.received", "discrepancy.resolved",
    ]) {
      expect(actions).toContain(action);
    }
    await expect(pg.query("delete from public.warehouse_stock_movements")).rejects.toThrow(/append-only/);
  });
});

describe("cancelled and disputed shipments", () => {
  it("returns cancelled requests to the dispatch queue with their stock still reserved", async () => {
    const approved = (await get("/api/v1/warehouse/requests?status=approved&commodity=JOWAR", "mys")).body.items[0];
    const first = await post("/api/v1/warehouse/shipments", "mys", { shopId: approved.shopId, requestIds: [approved.id], expectedDeliveryDate: tomorrow }, newKey());
    expect((await post(`/api/v1/warehouse/shipments/${first.body.shipment.id}/cancel`, "mys", { reason: "Lorry unavailable" })).body.shipment.status).toBe("cancelled");
    expect(await warehouseStock("JOWAR")).toEqual({ on_hand: 100, reserved: 80 });

    const second = await post("/api/v1/warehouse/shipments", "mys", { shopId: approved.shopId, requestIds: [approved.id], expectedDeliveryDate: tomorrow }, newKey());
    expect(second.status).toBe(201);
    await post(`/api/v1/warehouse/shipments/${second.body.shipment.id}/dispatch`, "mys");

    const shop = Object.keys(shops).find((s) => shops[s] === approved.shopId)!;
    const disputed = await post(`/api/v1/shop/shipments/${second.body.shipment.id}/dispute`, shop, { reason: "Not arrived two days after the expected date" });
    expect(disputed.body.shipment).toMatchObject({ status: "disputed", disputeReason: "Not arrived two days after the expected date" });

    const item = disputed.body.shipment.detailItems[0];
    const received = await post(`/api/v1/shop/shipments/${second.body.shipment.id}/receive`, shop, {
      items: [{ itemId: item.id, receivedQuantity: 80, damagedQuantity: 0 }],
    });
    expect(received.body.shipment.status).toBe("delivered");
    expect(await shopStock(shop, "JOWAR")).toBe(80);
  });
});

describe("automation and dashboards", () => {
  it("notifies the warehouse once when a shop drops below its threshold", async () => {
    await patch("/api/v1/shop/inventory/RICE/threshold", "a", { lowStockThreshold: 150, targetStock: 400 });
    const before = await scalar<number>("select count(*)::int as v from public.notifications where user_id = $1 and kind = 'stock.low'", [users.mys]);
    for (const quantity of [60, 10]) {
      await post("/api/v1/shop/movements", "a", { kind: "distribution", commodityCode: "RICE", quantity, reason: "Distributed" }, newKey());
    }
    const after = await scalar<number>("select count(*)::int as v from public.notifications where user_id = $1 and kind = 'stock.low'", [users.mys]);
    expect(after - before).toBe(1);
    const suggestion = (await get("/api/v1/shop/suggestions", "a")).body.items.find((s: { commodityCode: string }) => s.commodityCode === "RICE");
    expect(suggestion).toMatchObject({ onHand: 130, target: 400, targetIsDefault: false, suggestedQuantity: 270 });
  });

  it("refuses a target at or below the threshold", async () => {
    const res = await patch("/api/v1/shop/inventory/RICE/threshold", "a", { lowStockThreshold: 150, targetStock: 150 });
    expect(res.status).toBe(400);
  });

  it("summarises the warehouse from the database", async () => {
    const res = await get("/api/v1/warehouse/overview", "mys");
    // Shop C's ragi request and the jowar request that lost the race are still pending.
    expect(res.body.metrics).toMatchObject({
      pendingRequests: 2,
      activeShipments: 0,
      awaitingReceipt: 0,
      openDiscrepancies: 0,
      lowWarehouseStock: expect.any(Number),
    });
    expect(res.body.metrics.lowStockShops).toBeGreaterThanOrEqual(2);
    expect(res.body.requests).toHaveLength(2);
  });

  it("filters, searches and pages requests", async () => {
    const all = (await get("/api/v1/warehouse/requests?status=all", "mys")).body;
    expect(all.total).toBeGreaterThanOrEqual(7);
    const byRef = (await get(`/api/v1/warehouse/requests?status=all&q=${all.items[0].reference}`, "mys")).body;
    expect(byRef.items.map((r: { id: string }) => r.id)).toEqual([all.items[0].id]);
    expect((await get("/api/v1/warehouse/requests?status=all&q=0902", "mys")).body.items.every((r: { fpsId: string }) => r.fpsId.endsWith("0902"))).toBe(true);
    expect((await get("/api/v1/warehouse/requests?status=all&page=2", "mys")).body.items).toEqual([]);
    expect((await get("/api/v1/warehouse/requests?priority=extreme", "mys")).status).toBe(400);
  });

  it("reports per-commodity stock and usage, marking short history", async () => {
    const res = await get("/api/v1/warehouse/analytics", "mys");
    const rice = res.body.items.find((i: { commodityCode: string }) => i.commodityCode === "RICE");
    expect(rice).toMatchObject({ warehouseOnHand: 17880, warehouseAvailable: 17880, forecast: { status: "insufficient" } });
    expect(rice.usage.entries).toBeGreaterThanOrEqual(2);
  });

  it("marks notifications read for the signed-in person only", async () => {
    const res = await post("/api/v1/notifications/read", "a");
    expect(res.body.marked).toBeGreaterThan(0);
    expect((await get("/api/v1/notifications", "a")).body.unread).toBe(0);
    expect((await get("/api/v1/notifications", "mys")).body.unread).toBeGreaterThan(0);
  });
});
