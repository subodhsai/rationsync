import {
  buildSuggestion,
  reasonOnlySchema,
  receiveShipmentSchema,
  replenishmentRequestSchema,
  type InventoryItem,
  type OpenRequestRef,
  type UsageHistory,
} from "@rationsync/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { actorOf, requireApprovedShop } from "../auth.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { idempotencyKeyOf, idempotentWrite } from "../idempotency.js";
import { forShop, loadRequests, loadShipmentDetail, loadShipments, usageLateral } from "../supply-queries.js";

const requestListQuery = z.object({ status: z.enum(["open", "closed", "all"]).default("all") });
const shipmentListQuery = z.object({ status: z.enum(["incoming", "received", "all"]).default("all") });

const requestStatusSql = { open: "and r.status in ('pending', 'approved')", closed: "and r.status not in ('pending', 'approved')", all: "" };
const shipmentStatusSql = {
  // Shops see shipments once they leave the warehouse; preparing ones are still internal.
  incoming: "and sh.status in ('dispatched', 'in_transit', 'disputed')",
  received: "and sh.status in ('delivered', 'partially_received')",
  all: "and sh.status not in ('preparing', 'cancelled')",
};

export function shopSupplyRouter(db: Db): Router {
  const router = Router();
  router.use(requireApprovedShop);
  const shopIdOf = (req: Request) => actorOf(req).shop!.id;
  const idParam = (req: Request, what: "request" | "shipment") => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, `${what}_not_found`, `No such ${what} for your shop.`);
    return id.data;
  };
  async function ownRequest(req: Request, id: string) {
    const [request] = await loadRequests(db, "r.id = $1 and r.shop_id = $2", [id, shopIdOf(req)]);
    if (!request) throw new HttpError(404, "request_not_found", "No such request for your shop.");
    return forShop(request);
  }
  async function ownShipment(req: Request, id: string) {
    const shipment = await loadShipmentDetail(db, id);
    if (!shipment || shipment.shopId !== shopIdOf(req) || shipment.status === "preparing" || shipment.status === "cancelled") {
      throw new HttpError(404, "shipment_not_found", "No such shipment for your shop.");
    }
    return shipment;
  }

  router.get("/requests", async (req, res) => {
    const { status } = requestListQuery.parse(req.query);
    const items = await loadRequests(db, `r.shop_id = $1 ${requestStatusSql[status]}`, [shopIdOf(req)], "order by r.created_at desc limit 200");
    res.json({ items: items.map(forShop) });
  });

  router.get("/requests/:id", async (req, res) => {
    res.json({ request: await ownRequest(req, idParam(req, "request")) });
  });

  router.post("/requests", async (req, res) => {
    const key = idempotencyKeyOf(req);
    const input = replenishmentRequestSchema.parse(req.body);
    const shopId = shopIdOf(req);
    const id = await idempotentWrite(
      async () =>
        (
          await db.query<{ id: string }>(
            "select (public.create_replenishment_request($1, $2, $3, $4, $5, $6, $7, $8)).id as id",
            [shopId, actorOf(req).id, input.commodityCode, input.quantity, input.reason, input.priority, input.suggestedQuantity ?? null, key],
          )
        ).rows[0]!.id,
      "replenishment_requests_shop_id_idempotency_key_key",
      async () =>
        (
          await db.query<{ id: string }>(
            "select id from public.replenishment_requests where shop_id = $1 and idempotency_key = $2",
            [shopId, key],
          )
        ).rows[0]!.id,
    );
    const request = await ownRequest(req, id);
    if (request.commodityCode !== input.commodityCode || request.requestedQuantity !== input.quantity) {
      throw new HttpError(409, "idempotency_key_reused", "This Idempotency-Key was already used for a different request.");
    }
    res.status(201).json({ request });
  });

  router.post("/requests/:id/cancel", async (req, res) => {
    const id = idParam(req, "request");
    await db.query("select public.cancel_replenishment_request($1, $2)", [id, actorOf(req).id]);
    res.json({ request: await ownRequest(req, id) });
  });

  // One row per stocked commodity: what to request now, or the open request already covering it.
  router.get("/suggestions", async (req, res) => {
    const { rows } = await db.query<
      Pick<InventoryItem, "commodityCode" | "nameEn" | "nameKn" | "unit" | "quantity" | "lowStockThreshold" | "targetStock"> &
        UsageHistory & { openRequest: OpenRequestRef | null }
    >(
      `select c.code as "commodityCode", c.name_en as "nameEn", c.name_kn as "nameKn", c.unit,
              i.quantity::float8 as quantity, i.low_stock_threshold::float8 as "lowStockThreshold",
              i.target_stock::float8 as "targetStock", u.distributed, u.entries, u.days,
              (select json_build_object('id', r.id, 'reference', public.request_reference(r.number), 'status', r.status,
                                        'quantity', coalesce(r.approved_quantity, r.requested_quantity)::float8)
                 from public.replenishment_requests r
                where r.shop_id = i.shop_id and r.commodity_code = i.commodity_code and r.status in ('pending', 'approved')
                limit 1) as "openRequest"
         from public.shop_inventory i
         join public.commodities c on c.code = i.commodity_code
         ${usageLateral("i.shop_id", "i.commodity_code")}
        where i.shop_id = $1
        order by c.sort_order`,
      [shopIdOf(req)],
    );
    res.json({
      items: rows.map(({ distributed, entries, days, openRequest, ...item }) =>
        buildSuggestion(item, openRequest, { distributed, entries, days }),
      ),
    });
  });

  router.get("/shipments", async (req, res) => {
    const { status } = shipmentListQuery.parse(req.query);
    res.json({
      items: await loadShipments(db, `sh.shop_id = $1 ${shipmentStatusSql[status]}`, [shopIdOf(req)], "order by sh.dispatched_at desc limit 200"),
    });
  });

  router.get("/shipments/:id", async (req, res) => {
    res.json({ shipment: await ownShipment(req, idParam(req, "shipment")) });
  });

  // receive_shipment locks the shipment and refuses a second confirmation, so a repeated
  // submit can never credit stock twice.
  router.post("/shipments/:id/receive", async (req, res) => {
    const id = idParam(req, "shipment");
    const { items, note } = receiveShipmentSchema.parse(req.body);
    await db.query("select public.receive_shipment($1, $2, $3, $4)", [id, actorOf(req).id, JSON.stringify(items), note ?? null]);
    res.json({ shipment: await ownShipment(req, id) });
  });

  router.post("/shipments/:id/dispute", async (req, res) => {
    const id = idParam(req, "shipment");
    const { reason } = reasonOnlySchema.parse(req.body);
    await db.query("select public.dispute_shipment($1, $2, $3)", [id, actorOf(req).id, reason]);
    res.json({ shipment: await ownShipment(req, id) });
  });

  return router;
}
