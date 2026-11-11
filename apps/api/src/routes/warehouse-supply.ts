import {
  ACTIVE_SHIPMENT,
  AWAITING_RECEIPT,
  createShipmentSchema,
  dispatchShipmentSchema,
  FORECAST_WINDOW_DAYS,
  forecastCoverage,
  KARNATAKA_DISTRICTS,
  priorityRank,
  reasonOnlySchema,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  requestDecisionSchema,
  resolveDiscrepancySchema,
  thresholdSchema,
  warehouseMovementDelta,
  warehouseMovementSchema,
  type Commodity,
  type CommodityAnalytics,
  type ReconciliationRow,
  type UsageHistory,
  type WarehouseMovement,
  type WarehouseOverview,
} from "@rationsync/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { actorOf, requireRole } from "../auth.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { idempotencyKeyOf, idempotentWrite } from "../idempotency.js";
import { loadRequests, loadShipmentDetail, loadShipments, loadWarehouseStock, paginate, type LoadedRequest } from "../supply-queries.js";

const code = z.string().regex(/^[A-Z_]{2,24}$/);
const page = z.coerce.number().int().min(1).max(1000).default(1);

const requestsQuery = z.object({
  status: z.enum([...REQUEST_STATUSES, "all"]).default("pending"),
  priority: z.enum(REQUEST_PRIORITIES).optional(),
  commodity: code.optional(),
  district: z.enum(KARNATAKA_DISTRICTS).optional(),
  shopId: z.uuid().optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(["recommended", "oldest", "newest"]).default("recommended"),
  page,
});

const shipmentsQuery = z.object({
  status: z.enum(["active", "awaiting_receipt", "closed", "all"]).default("active"),
  shopId: z.uuid().optional(),
  page,
});

const movementsQuery = z.object({
  warehouseId: z.uuid().optional(),
  commodity: code.optional(),
  page,
});

const shipmentStatusSets: Record<z.infer<typeof shipmentsQuery>["status"], string[] | null> = {
  active: ACTIVE_SHIPMENT,
  awaiting_receipt: AWAITING_RECEIPT,
  closed: ["delivered", "partially_received", "cancelled"],
  all: null,
};

/** Urgent first by the recommendation from current stock, then the oldest request. */
const byRecommendation = (a: LoadedRequest, b: LoadedRequest) =>
  priorityRank[a.recommendation.priority] - priorityRank[b.recommendation.priority] ||
  Date.parse(a.createdAt) - Date.parse(b.createdAt);

export function warehouseSupplyRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("warehouse_admin"));
  const scope = (req: Request) => actorOf(req).warehouseIds;
  const uuidParam = (req: Request, name: string, notFound: string) => {
    const id = z.uuid().safeParse(req.params[name]);
    if (!id.success) throw new HttpError(404, notFound, "Not found in your warehouses.");
    return id.data;
  };
  /** A warehouse the caller is assigned to; anything else answers 404 and reveals nothing. */
  const ownWarehouse = (req: Request, id: string | undefined) => {
    if (!id || !scope(req).includes(id)) throw new HttpError(404, "warehouse_not_found", "No such warehouse in your assignments.");
    return id;
  };
  async function scopedRequest(req: Request, id: string) {
    const [request] = await loadRequests(db, "r.id = $1 and r.warehouse_id = any($2::uuid[])", [id, scope(req)]);
    if (!request) throw new HttpError(404, "request_not_found", "No such request in your warehouses.");
    return request;
  }
  async function scopedShipment(req: Request, id: string) {
    const shipment = await loadShipmentDetail(db, id);
    if (!shipment || !scope(req).includes(shipment.warehouseId)) {
      throw new HttpError(404, "shipment_not_found", "No such shipment in your warehouses.");
    }
    return shipment;
  }

  // Overview --------------------------------------------------------------------

  router.get("/overview", async (req, res) => {
    const ids = scope(req);
    const { rows } = await db.query<Omit<WarehouseOverview, "urgentRequests">>(
      `select
         (select count(*) from public.replenishment_requests where warehouse_id = any($1::uuid[]) and status = 'pending')::int
           as "pendingRequests",
         (select count(*) from public.shipments where warehouse_id = any($1::uuid[]) and status::text = any($2::text[]))::int
           as "activeShipments",
         (select count(*) from public.shipments where warehouse_id = any($1::uuid[]) and status::text = any($3::text[]))::int
           as "awaitingReceipt",
         (select count(*) from public.shipments where warehouse_id = any($1::uuid[]) and status::text = any($3::text[])
             and expected_delivery_date < public.today_ist())::int as "overdueShipments",
         (select count(distinct a.shop_id) from public.stock_alerts a join public.shops s on s.id = a.shop_id
           where s.warehouse_id = any($1::uuid[]) and a.status = 'open')::int as "lowStockShops",
         (select count(*) from public.delivery_discrepancies d join public.shipments sh on sh.id = d.shipment_id
           where sh.warehouse_id = any($1::uuid[]) and d.status = 'open')::int as "openDiscrepancies",
         (select count(*) from public.warehouse_inventory where warehouse_id = any($1::uuid[])
             and quantity_on_hand - quantity_reserved <= low_stock_threshold)::int as "lowWarehouseStock"`,
      [ids, ACTIVE_SHIPMENT, AWAITING_RECEIPT],
    );
    const pending = (await loadRequests(db, "r.warehouse_id = any($1::uuid[]) and r.status = 'pending'", [ids])).sort(byRecommendation);
    const awaiting = await loadShipments(
      db,
      "sh.warehouse_id = any($1::uuid[]) and sh.status::text = any($2::text[])",
      [ids, AWAITING_RECEIPT],
      "order by sh.expected_delivery_date, sh.dispatched_at limit 5",
    );
    const metrics: WarehouseOverview = {
      ...rows[0]!,
      urgentRequests: pending.filter((r) => r.recommendation.priority === "urgent").length,
    };
    res.json({ metrics, requests: pending.slice(0, 5), shipments: awaiting });
  });

  // Warehouse stock --------------------------------------------------------------

  router.get("/commodities", async (_req, res) => {
    const { rows } = await db.query<Commodity>(
      `select code, name_en as "nameEn", name_kn as "nameKn", unit from public.commodities order by sort_order`,
    );
    res.json({ items: rows });
  });

  router.get("/inventory", async (req, res) => {
    res.json({ items: await loadWarehouseStock(db, scope(req)) });
  });

  router.get("/movements", async (req, res) => {
    const query = movementsQuery.parse(req.query);
    const ids = query.warehouseId ? [ownWarehouse(req, query.warehouseId)] : scope(req);
    const params: unknown[] = [ids];
    let where = "m.warehouse_id = any($1::uuid[])";
    if (query.commodity) {
      params.push(query.commodity);
      where += ` and m.commodity_code = $${params.length}`;
    }
    params.push(26, (query.page - 1) * 25);
    const { rows } = await db.query<WarehouseMovement>(
      `select m.id, m.warehouse_id as "warehouseId", m.commodity_code as "commodityCode", c.name_en as "commodityName",
              c.unit, m.kind, m.quantity_delta::float8 as "quantityDelta", m.balance_after::float8 as "balanceAfter",
              m.reason, m.reference, m.shipment_id as "shipmentId", nullif(p.full_name, '') as "actorName",
              m.created_at as "createdAt"
         from public.warehouse_stock_movements m
         join public.commodities c on c.code = m.commodity_code
         left join public.profiles p on p.id = m.actor_id
        where ${where}
        order by m.created_at desc, m.id desc
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    res.json({ items: rows.slice(0, 25), page: query.page, hasMore: rows.length > 25 });
  });

  router.post("/movements", async (req, res) => {
    const key = idempotencyKeyOf(req);
    const warehouseId = ownWarehouse(req, z.object({ warehouseId: z.uuid() }).parse(req.body).warehouseId);
    const input = warehouseMovementSchema.parse(req.body);
    const delta = warehouseMovementDelta(input);
    const id = await idempotentWrite(
      async () =>
        (
          await db.query<{ id: string }>(
            "select (public.apply_warehouse_movement($1, $2, $3, $4, $5, $6, $7, $8)).id as id",
            [warehouseId, input.commodityCode, input.kind, delta, input.reason,
             input.kind === "receipt" ? input.reference || null : null, actorOf(req).id, key],
          )
        ).rows[0]!.id,
      "warehouse_stock_movements_warehouse_id_idempotency_key_key",
      async () =>
        (
          await db.query<{ id: string }>(
            "select id from public.warehouse_stock_movements where warehouse_id = $1 and idempotency_key = $2",
            [warehouseId, key],
          )
        ).rows[0]!.id,
    );
    const { rows } = await db.query<{ commodityCode: string; quantityDelta: number }>(
      `select commodity_code as "commodityCode", quantity_delta::float8 as "quantityDelta"
         from public.warehouse_stock_movements where id = $1`,
      [id],
    );
    if (rows[0]!.commodityCode !== input.commodityCode || rows[0]!.quantityDelta !== delta) {
      throw new HttpError(409, "idempotency_key_reused", "This Idempotency-Key was already used for a different movement.");
    }
    const item = (await loadWarehouseStock(db, [warehouseId])).find((i) => i.commodityCode === input.commodityCode);
    res.status(201).json({ movementId: id, item });
  });

  router.patch("/inventory/:warehouseId/:code/threshold", async (req, res) => {
    const warehouseId = ownWarehouse(req, req.params.warehouseId);
    const commodity = code.parse(req.params.code);
    const { lowStockThreshold } = thresholdSchema.parse(req.body);
    await db.query("select public.set_warehouse_threshold($1, $2, $3, $4)", [warehouseId, commodity, lowStockThreshold, actorOf(req).id]);
    res.json({ item: (await loadWarehouseStock(db, [warehouseId])).find((i) => i.commodityCode === commodity) });
  });

  // Replenishment requests -----------------------------------------------------------

  // ponytail: filters in SQL, recommendation sort and paging in memory (bounded to 500 rows);
  // move the priority rule into SQL if a warehouse ever has more open requests than that.
  router.get("/requests", async (req, res) => {
    const query = requestsQuery.parse(req.query);
    const params: unknown[] = [scope(req)];
    const filters = ["r.warehouse_id = any($1::uuid[])"];
    const add = (sql: (n: number) => string, value: unknown) => {
      params.push(value);
      filters.push(sql(params.length));
    };
    if (query.status !== "all") add((n) => `r.status = $${n}`, query.status);
    if (query.priority) add((n) => `r.priority = $${n}`, query.priority);
    if (query.commodity) add((n) => `r.commodity_code = $${n}`, query.commodity);
    if (query.district) add((n) => `s.district = $${n}`, query.district);
    if (query.shopId) add((n) => `r.shop_id = $${n}`, query.shopId);
    if (query.q) {
      add(
        (n) => `(s.name ilike $${n} or s.fps_id ilike $${n} or public.request_reference(r.number) ilike $${n})`,
        `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
      );
    }
    const rows = await loadRequests(db, filters.join(" and "), params, "order by r.created_at desc limit 500");
    if (query.sort === "recommended") rows.sort(byRecommendation);
    if (query.sort === "oldest") rows.reverse();
    res.json(paginate(rows, query.page));
  });

  router.get("/requests/:id", async (req, res) => {
    const request = await scopedRequest(req, uuidParam(req, "id", "request_not_found"));
    const { rows } = await db.query<{ onHand: number; reserved: number; available: number }>(
      `select quantity_on_hand::float8 as "onHand", quantity_reserved::float8 as reserved,
              (quantity_on_hand - quantity_reserved)::float8 as available
         from public.warehouse_inventory where warehouse_id = $1 and commodity_code = $2`,
      [request.warehouseId, request.commodityCode],
    );
    res.json({ request: { ...request, warehouseStock: rows[0] ?? null } });
  });

  // decide_replenishment_request re-checks scope and the pending state under a row lock, and
  // the reservation cannot exceed unreserved stock even when two approvals race.
  router.post("/requests/:id/decision", async (req, res) => {
    const id = uuidParam(req, "id", "request_not_found");
    await scopedRequest(req, id);
    const input = requestDecisionSchema.parse(req.body);
    await db.query("select public.decide_replenishment_request($1, $2, $3, $4, $5)", [
      id,
      actorOf(req).id,
      input.decision,
      input.decision === "approved" ? input.approvedQuantity : null,
      input.reason,
    ]);
    res.json({ request: await scopedRequest(req, id) });
  });

  // Shipments -----------------------------------------------------------------------

  router.get("/shipments", async (req, res) => {
    const query = shipmentsQuery.parse(req.query);
    const params: unknown[] = [scope(req)];
    let where = "sh.warehouse_id = any($1::uuid[])";
    const statuses = shipmentStatusSets[query.status];
    if (statuses) {
      params.push(statuses);
      where += ` and sh.status::text = any($${params.length}::text[])`;
    }
    if (query.shopId) {
      params.push(query.shopId);
      where += ` and sh.shop_id = $${params.length}`;
    }
    const rows = await loadShipments(db, where, params, "order by sh.created_at desc limit 500");
    res.json(paginate(rows, query.page));
  });

  router.get("/shipments/:id", async (req, res) => {
    res.json({ shipment: await scopedShipment(req, uuidParam(req, "id", "shipment_not_found")) });
  });

  router.post("/shipments", async (req, res) => {
    const key = idempotencyKeyOf(req);
    const input = createShipmentSchema.parse(req.body);
    const actor = actorOf(req);
    const id = await idempotentWrite(
      async () =>
        (
          await db.query<{ id: string }>("select (public.create_shipment($1, $2, $3, $4, $5, $6)).id as id", [
            actor.id,
            input.shopId,
            input.requestIds,
            input.expectedDeliveryDate,
            input.notes ?? null,
            key,
          ])
        ).rows[0]!.id,
      "shipments_created_by_idempotency_key_key",
      async () =>
        (await db.query<{ id: string }>("select id from public.shipments where created_by = $1 and idempotency_key = $2", [actor.id, key]))
          .rows[0]!.id,
    );
    res.status(201).json({ shipment: await scopedShipment(req, id) });
  });

  router.post("/shipments/:id/dispatch", async (req, res) => {
    const id = uuidParam(req, "id", "shipment_not_found");
    const { expectedDeliveryDate } = dispatchShipmentSchema.parse(req.body ?? {});
    await db.query("select public.dispatch_shipment($1, $2, $3)", [id, actorOf(req).id, expectedDeliveryDate ?? null]);
    res.json({ shipment: await scopedShipment(req, id) });
  });

  router.post("/shipments/:id/in-transit", async (req, res) => {
    const id = uuidParam(req, "id", "shipment_not_found");
    await db.query("select public.mark_shipment_in_transit($1, $2)", [id, actorOf(req).id]);
    res.json({ shipment: await scopedShipment(req, id) });
  });

  router.post("/shipments/:id/cancel", async (req, res) => {
    const id = uuidParam(req, "id", "shipment_not_found");
    const { reason } = reasonOnlySchema.parse(req.body);
    await db.query("select public.cancel_shipment($1, $2, $3)", [id, actorOf(req).id, reason]);
    res.json({ shipment: await scopedShipment(req, id) });
  });

  router.post("/discrepancies/:id/resolve", async (req, res) => {
    const id = uuidParam(req, "id", "discrepancy_not_found");
    const { resolution } = resolveDiscrepancySchema.parse(req.body);
    const { rows } = await db.query<{ shipment_id: string }>("select (public.resolve_discrepancy($1, $2, $3)).shipment_id", [
      id,
      actorOf(req).id,
      resolution,
    ]);
    res.json({ shipment: await scopedShipment(req, rows[0]!.shipment_id) });
  });

  // Reconciliation and analytics ---------------------------------------------------

  router.get("/reconciliation", async (req, res) => {
    const { status } = z.object({ status: z.enum(["discrepancies", "all"]).default("all") }).parse(req.query);
    const { rows } = await db.query<ReconciliationRow>(
      `select r.id as "requestId", public.request_reference(r.number) as "requestReference",
              x.shipment_id as "shipmentId", public.shipment_reference(x.number) as "shipmentReference",
              x.status as "shipmentStatus", s.name as "shopName", s.fps_id as "fpsId",
              c.name_en as "commodityName", c.unit,
              r.requested_quantity::float8 as requested, r.approved_quantity::float8 as approved,
              case when x.dispatched_at is not null then x.quantity::float8 end as dispatched,
              x.received_quantity::float8 as received, x.damaged_quantity::float8 as damaged,
              (x.quantity - x.received_quantity - x.damaged_quantity)::float8 as shortage,
              d.status as "discrepancyStatus"
         from public.replenishment_requests r
         join public.shops s on s.id = r.shop_id
         join public.commodities c on c.code = r.commodity_code
         left join lateral (
           select si.id, si.quantity, si.received_quantity, si.damaged_quantity,
                  sh.id as shipment_id, sh.number, sh.status, sh.dispatched_at
             from public.shipment_items si join public.shipments sh on sh.id = si.shipment_id
            where si.request_id = r.id and sh.status <> 'cancelled'
            limit 1
         ) x on true
         left join public.delivery_discrepancies d on d.shipment_item_id = x.id
        where r.warehouse_id = any($1::uuid[])
          and r.status in ('approved', 'partially_fulfilled', 'fulfilled')
          and ($2 = 'all' or d.id is not null)
        order by (d.status = 'open') desc nulls last, r.decided_at desc
        limit 200`,
      [scope(req), status],
    );
    res.json({ items: rows });
  });

  router.get("/analytics", async (req, res) => {
    const window = `interval '${FORECAST_WINDOW_DAYS} days'`;
    const shopsInScope = "join public.shops s on s.id = i.shop_id where s.warehouse_id = any($1::uuid[]) and s.status = 'approved'";
    const { rows } = await db.query<Omit<CommodityAnalytics, "usage" | "forecast" | "warehouseAvailable"> & UsageHistory>(
      `select c.code as "commodityCode", c.name_en as "nameEn", c.unit,
              coalesce((select sum(quantity_on_hand) from public.warehouse_inventory
                         where commodity_code = c.code and warehouse_id = any($1::uuid[])), 0)::float8 as "warehouseOnHand",
              coalesce((select sum(quantity_reserved) from public.warehouse_inventory
                         where commodity_code = c.code and warehouse_id = any($1::uuid[])), 0)::float8 as "warehouseReserved",
              coalesce((select sum(si.quantity) from public.shipment_items si join public.shipments sh on sh.id = si.shipment_id
                         where si.commodity_code = c.code and sh.warehouse_id = any($1::uuid[])
                           and sh.status in ('dispatched', 'in_transit', 'disputed')), 0)::float8 as "inTransit",
              coalesce((select sum(i.quantity) from public.shop_inventory i ${shopsInScope} and i.commodity_code = c.code), 0)::float8
                as "shopStock",
              (select count(*) from public.shop_inventory i ${shopsInScope} and i.commodity_code = c.code)::int as "shopsStocking",
              (select count(*) from public.shop_inventory i ${shopsInScope} and i.commodity_code = c.code
                  and i.quantity <= i.low_stock_threshold)::int as "shopsLow",
              coalesce((select sum(-m.quantity_delta) from public.stock_movements m join public.shops s on s.id = m.shop_id
                         where s.warehouse_id = any($1::uuid[]) and m.commodity_code = c.code and m.kind = 'distribution'
                           and m.created_at > now() - ${window}), 0)::float8 as distributed,
              (select count(*) from public.stock_movements m join public.shops s on s.id = m.shop_id
                where s.warehouse_id = any($1::uuid[]) and m.commodity_code = c.code and m.kind = 'distribution'
                  and m.created_at > now() - ${window})::int as entries,
              coalesce((select least(${FORECAST_WINDOW_DAYS}, floor(extract(epoch from now() - min(m.created_at)) / 86400))
                          from public.stock_movements m join public.shops s on s.id = m.shop_id
                         where s.warehouse_id = any($1::uuid[]) and m.commodity_code = c.code), 0)::int as days
         from public.commodities c
        order by c.sort_order`,
      [scope(req)],
    );
    const items: CommodityAnalytics[] = rows
      .filter((r) => r.warehouseOnHand > 0 || r.shopsStocking > 0)
      .map(({ distributed, entries, days, ...r }) => {
        const usage = { distributed, entries, days };
        return {
          ...r,
          warehouseAvailable: r.warehouseOnHand - r.warehouseReserved,
          usage,
          // Everything that will reach card holders: warehouse stock, stock on the road, shop stock.
          forecast: forecastCoverage(r.warehouseOnHand + r.inTransit + r.shopStock, usage, r.unit),
        };
      });
    res.json({ items });
  });

  return router;
}
