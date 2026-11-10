import type { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp, createTestDb, createUser } from "./test-db.js";

// Phase 2 workflows end to end: real Express app, real migrations, real database functions.

const MYS_WAREHOUSE = "0d9a0000-0000-4000-a000-000000000001";
const DWD_WAREHOUSE = "0d9a0000-0000-4000-a000-000000000002";

let pg: PGlite;
let app: ReturnType<typeof createTestApp>["app"];
let bearer: ReturnType<typeof createTestApp>["bearer"];
const users: Record<string, string> = {};

const as = async (user: string) => ({ Authorization: await bearer(users[user]!) });
const get = async (path: string, user: string) => request(app).get(path).set(await as(user));
const post = async (path: string, user: string, body: object, headers: Record<string, string> = {}) =>
  request(app).post(path).set({ ...(await as(user)), ...headers }).send(body);

const application = (overrides: object = {}) => ({
  fpsId: "demo-fps-mys-0401",
  name: "Demo FPS Gokulam",
  district: "Mysuru",
  taluk: "Mysuru",
  address: "3rd Main, Gokulam, Mysuru",
  pinCode: "570002",
  contactPhone: "98450 12345",
  contactEmail: "",
  warehouseId: MYS_WAREHOUSE,
  ...overrides,
});

beforeAll(async () => {
  pg = await createTestDb();
  ({ app, bearer } = createTestApp(pg));
  for (const name of ["applicant", "second", "racer", "rejected"]) {
    users[name] = await createUser(pg, `${name}@example.test`, { account_type: "shop_admin", full_name: `Demo ${name}` });
  }
  users.beneficiary = await createUser(pg, "wf-beneficiary@example.test");
  for (const [name, code] of [
    ["mys", "DEMO-WH-MYS"],
    ["dwd", "DEMO-WH-DWD"],
  ] as const) {
    users[name] = await createUser(pg, `${name}-admin@example.test`, { full_name: `Demo ${name} admin` });
    await pg.query("select public.provision_warehouse_admin($1, $2)", [`${name}-admin@example.test`, code]);
  }
}, 60_000);

describe("shop registration", () => {
  it("rejects invalid input with field-level details", async () => {
    const res = await post("/api/v1/registration", "applicant", application({ pinCode: "110001", fpsId: "x" }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["fpsId", "pinCode"]);
  });

  it("creates a pending application with normalised values", async () => {
    const res = await post("/api/v1/registration", "applicant", application());
    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({
      fpsId: "DEMO-FPS-MYS-0401",
      status: "pending",
      contactPhone: "+91 98450 12345",
      contactEmail: null,
      warehouse: { id: MYS_WAREHOUSE, code: "DEMO-WH-MYS" },
      documents: [],
      reviews: [],
    });
  });

  it("refuses an FPS ID that is already registered", async () => {
    const res = await post("/api/v1/registration", "second", application({ fpsId: "DEMO-FPS-MYS-0401" }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("fps_id_taken");
  });

  it("refuses a second application from the same account", async () => {
    const res = await post("/api/v1/registration", "applicant", application({ fpsId: "DEMO-FPS-MYS-0402" }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("registration_exists");
  });

  it("refuses an unknown warehouse", async () => {
    const res = await post(
      "/api/v1/registration",
      "second",
      application({ fpsId: "DEMO-FPS-MYS-0403", warehouseId: "0d9a0000-0000-4000-a000-0000000000ff" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("unknown_warehouse");
  });

  it("is closed to beneficiaries", async () => {
    expect((await post("/api/v1/registration", "beneficiary", application({ fpsId: "DEMO-FPS-MYS-0404" }))).status).toBe(
      403,
    );
  });

  it("keeps shop tools locked while pending", async () => {
    const res = await get("/api/v1/shop/inventory", "applicant");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("shop_not_approved");
  });
});

describe("supporting documents", () => {
  const upload = (path: string, size = 2048) =>
    pg.query(
      `insert into storage.objects (bucket_id, name, owner, metadata)
       values ('shop-documents', $1, $2, jsonb_build_object('size', $3::int, 'mimetype', 'application/pdf'))`,
      [path, users.applicant, size],
    );

  it("records an uploaded file using the size and type Storage reports", async () => {
    const path = `${users.applicant}/licence.pdf`;
    await upload(path, 4096);
    const res = await post("/api/v1/registration/documents", "applicant", { storagePath: path, fileName: "Licence.pdf" });
    expect(res.status).toBe(201);
    expect(res.body.application.documents).toMatchObject([
      { fileName: "Licence.pdf", sizeBytes: 4096, contentType: "application/pdf" },
    ]);
  });

  it("refuses a path outside the caller's folder", async () => {
    const res = await post("/api/v1/registration/documents", "applicant", {
      storagePath: `${users.second}/licence.pdf`,
      fileName: "Licence.pdf",
    });
    expect(res.status).toBe(403);
  });

  it("refuses a file that was never uploaded", async () => {
    const res = await post("/api/v1/registration/documents", "applicant", {
      storagePath: `${users.applicant}/missing.pdf`,
      fileName: "Missing.pdf",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("upload_missing");
  });
});

describe("warehouse review", () => {
  let applicantShop: string;

  beforeAll(async () => {
    applicantShop = (await get("/api/v1/registration", "applicant")).body.application.id;
  });

  it("lists the application only for the shop's own warehouse", async () => {
    const mys = await get("/api/v1/warehouse/shop-registrations?status=pending", "mys");
    expect(mys.body.items.map((s: { fpsId: string }) => s.fpsId)).toContain("DEMO-FPS-MYS-0401");
    const dwd = await get("/api/v1/warehouse/shop-registrations?status=pending", "dwd");
    expect(dwd.body.items.map((s: { fpsId: string }) => s.fpsId)).not.toContain("DEMO-FPS-MYS-0401");
  });

  it("refuses a warehouse filter outside the caller's assignments", async () => {
    const res = await get(`/api/v1/warehouse/shop-registrations?warehouseId=${DWD_WAREHOUSE}`, "mys");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden_warehouse");
  });

  it("filters by district", async () => {
    const res = await get("/api/v1/warehouse/shop-registrations?status=approved&district=Dharwad", "mys");
    expect(res.body.items).toEqual([]);
  });

  it("hides another warehouse's shop entirely", async () => {
    expect((await get(`/api/v1/warehouse/shops/${applicantShop}`, "dwd")).status).toBe(404);
    const res = await post(`/api/v1/warehouse/shops/${applicantShop}/review`, "dwd", {
      decision: "approved",
      reason: "Cross-warehouse attempt",
    });
    expect(res.status).toBe(404);
  });

  it("does not let a shop administrator review", async () => {
    const res = await post(`/api/v1/warehouse/shops/${applicantShop}/review`, "applicant", {
      decision: "approved",
      reason: "Approving myself",
    });
    expect(res.status).toBe(403);
  });

  it("requires a reason", async () => {
    const res = await post(`/api/v1/warehouse/shops/${applicantShop}/review`, "mys", { decision: "approved", reason: "" });
    expect(res.status).toBe(400);
  });

  it("shows the full application, then approves it once", async () => {
    const detail = await get(`/api/v1/warehouse/shops/${applicantShop}`, "mys");
    expect(detail.body.shop).toMatchObject({ fpsId: "DEMO-FPS-MYS-0401", pinCode: "570002", inventory: [], alerts: [] });
    expect(detail.body.shop.documents).toHaveLength(1);

    const approve = await post(`/api/v1/warehouse/shops/${applicantShop}/review`, "mys", {
      decision: "approved",
      reason: "FPS ID and address match the demo licence",
    });
    expect(approve.status).toBe(200);
    expect(approve.body.application).toMatchObject({ status: "approved", reviews: [{ decision: "approved", reviewerName: "Demo mys admin" }] });

    const again = await post(`/api/v1/warehouse/shops/${applicantShop}/review`, "mys", {
      decision: "rejected",
      reason: "Second opinion",
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_decided");
  });

  it("settles two simultaneous decisions on one application exactly once", async () => {
    await post("/api/v1/registration", "racer", application({ fpsId: "DEMO-FPS-MYS-0405" }));
    const shopId = (await get("/api/v1/registration", "racer")).body.application.id;
    const [a, b] = await Promise.all([
      post(`/api/v1/warehouse/shops/${shopId}/review`, "mys", { decision: "approved", reason: "Reviewer one" }),
      post(`/api/v1/warehouse/shops/${shopId}/review`, "mys", { decision: "rejected", reason: "Reviewer two" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("lets a rejected applicant correct and resubmit", async () => {
    await post("/api/v1/registration", "rejected", application({ fpsId: "DEMO-FPS-MYS-0406" }));
    const shopId = (await get("/api/v1/registration", "rejected")).body.application.id;
    await post(`/api/v1/warehouse/shops/${shopId}/review`, "mys", { decision: "rejected", reason: "PIN code does not match" });

    const res = await post("/api/v1/registration", "rejected", application({ fpsId: "DEMO-FPS-MYS-0406", pinCode: "570009" }));
    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({ id: shopId, status: "pending", pinCode: "570009", reviewReason: null });
    expect(res.body.application.reviews).toHaveLength(1);
  });

  it("lists decisions in the administrator's scope only", async () => {
    const mys = await get("/api/v1/warehouse/reviews", "mys");
    expect(mys.body.items.length).toBeGreaterThanOrEqual(3);
    expect((await get("/api/v1/warehouse/reviews", "dwd")).body.items).toEqual([]);
  });

  it("records every decision in the audit log", async () => {
    const { rows } = await pg.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where action in ('shop.approved', 'shop.rejected') and actor_id = $1",
      [users.mys],
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(3);
  });
});

describe("inventory after approval", () => {
  const movement = (body: object, key: string) =>
    post("/api/v1/shop/movements", "applicant", body, { "Idempotency-Key": key });
  const riceBalance = async () =>
    (await get("/api/v1/shop/inventory", "applicant")).body.items.find((i: { commodityCode: string }) => i.commodityCode === "RICE")
      ?.quantity;

  it("records an opening balance once", async () => {
    const res = await movement({ kind: "opening_balance", commodityCode: "RICE", quantity: 500, reason: "Count on approval" }, "wf-open-rice-1");
    expect(res.status).toBe(201);
    expect(res.body.movement).toMatchObject({ kind: "opening_balance", quantityDelta: 500, balanceAfter: 500, actorName: "Demo applicant" });

    const second = await movement({ kind: "opening_balance", commodityCode: "RICE", quantity: 20, reason: "Again" }, "wf-open-rice-2");
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("opening_balance_exists");
  });

  it("requires an idempotency key", async () => {
    const res = await post("/api/v1/shop/movements", "applicant", {
      kind: "distribution",
      commodityCode: "RICE",
      quantity: 5,
      reason: "No key",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("idempotency_key_required");
  });

  it("deducts a distribution and applies a retried request once", async () => {
    const body = { kind: "distribution", commodityCode: "RICE", quantity: 120.5, reason: "Morning distribution" };
    const first = await movement(body, "wf-dist-0001");
    const retry = await movement(body, "wf-dist-0001");
    expect(first.status).toBe(201);
    expect(retry.body.movement.id).toBe(first.body.movement.id);
    expect(await riceBalance()).toBe(379.5);
  });

  it("refuses to reuse a key for a different movement", async () => {
    const res = await movement({ kind: "distribution", commodityCode: "RICE", quantity: 1, reason: "Different" }, "wf-dist-0001");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("idempotency_key_reused");
  });

  it("refuses a deduction larger than the stock, changing nothing", async () => {
    const res = await movement({ kind: "distribution", commodityCode: "RICE", quantity: 10000, reason: "Too much" }, "wf-dist-0002");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("insufficient_stock");
    expect(await riceBalance()).toBe(379.5);
  });

  it("does not accept warehouse receipts from a shop", async () => {
    const res = await movement({ kind: "receipt", commodityCode: "RICE", quantity: 1000, reason: "Self-delivery" }, "wf-receipt-1");
    expect(res.status).toBe(400);
  });

  it("opens an alert when a movement crosses the threshold and resolves it on an increase", async () => {
    const threshold = await request(app)
      .patch("/api/v1/shop/inventory/RICE/threshold")
      .set(await as("applicant"))
      .send({ lowStockThreshold: 300 });
    expect(threshold.body.item).toMatchObject({ commodityCode: "RICE", lowStockThreshold: 300 });

    await movement({ kind: "distribution", commodityCode: "RICE", quantity: 100, reason: "Evening distribution" }, "wf-dist-0003");
    const open = await get("/api/v1/shop/alerts", "applicant");
    expect(open.body.items).toMatchObject([{ commodityCode: "RICE", status: "open", currentQuantity: 279.5, thresholdAtOpen: 300 }]);

    const warehouse = await get("/api/v1/warehouse/alerts", "mys");
    expect(warehouse.body.items.map((a: { fpsId: string }) => a.fpsId)).toContain("DEMO-FPS-MYS-0401");
    expect((await get("/api/v1/warehouse/alerts", "dwd")).body.items.map((a: { fpsId: string }) => a.fpsId)).not.toContain(
      "DEMO-FPS-MYS-0401",
    );

    await movement(
      { kind: "adjustment", direction: "increase", commodityCode: "RICE", quantity: 50, reason: "Recount found two sacks" },
      "wf-adj-0001",
    );
    expect((await get("/api/v1/shop/alerts", "applicant")).body.items).toEqual([]);
    const resolved = await get("/api/v1/shop/alerts?status=resolved", "applicant");
    expect(resolved.body.items).toMatchObject([{ commodityCode: "RICE", status: "resolved" }]);
  });

  it("applies simultaneous deductions without overdrawing", async () => {
    const before = await riceBalance();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        movement({ kind: "distribution", commodityCode: "RICE", quantity: 60, reason: "Rush hour" }, `wf-rush-${i}`),
      ),
    );
    const applied = results.filter((r) => r.status === 201).length;
    expect(results.every((r) => r.status === 201 || r.body.error.code === "insufficient_stock")).toBe(true);
    expect(await riceBalance()).toBe(before - applied * 60);
  });

  it("pages through the ledger newest first", async () => {
    const page1 = await get("/api/v1/shop/movements?limit=3", "applicant");
    expect(page1.body.items).toHaveLength(3);
    const page2 = await get(`/api/v1/shop/movements?limit=3&before=${page1.body.nextCursor}`, "applicant");
    const ids = [...page1.body.items, ...page2.body.items].map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const times = [...page1.body.items, ...page2.body.items].map((m: { createdAt: string }) => Date.parse(m.createdAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  it("filters the ledger by commodity and rejects a forged cursor", async () => {
    const rice = await get("/api/v1/shop/movements?commodity=WHEAT", "applicant");
    expect(rice.body.items).toEqual([]);
    expect((await get("/api/v1/shop/movements?before=not-a-cursor", "applicant")).status).toBe(400);
  });
});
