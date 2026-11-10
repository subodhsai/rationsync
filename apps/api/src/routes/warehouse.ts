import {
  KARNATAKA_DISTRICTS,
  reviewDecisionSchema,
  type ReviewHistoryItem,
  type ShopDetail,
  type ShopRegistrationSummary,
  type WarehouseOption,
} from "@rationsync/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { actorOf, requireRole } from "../auth.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { loadAlerts, loadApplication, loadInventory } from "../queries.js";

const registrationsQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  district: z.enum(KARNATAKA_DISTRICTS).optional(),
  warehouseId: z.uuid().optional(),
});

const alertQuery = z.object({ status: z.enum(["open", "resolved", "all"]).default("open") });

export function warehouseRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("warehouse_admin"));

  /** The shop's id if it belongs to one of the caller's warehouses; otherwise a 404 that reveals nothing. */
  async function shopInScope(req: Request): Promise<string> {
    const id = z.uuid().safeParse(req.params.id);
    const { rows } = id.success
      ? await db.query("select 1 from public.shops where id = $1 and warehouse_id = any($2::uuid[])", [
          id.data,
          actorOf(req).warehouseIds,
        ])
      : { rows: [] };
    if (!id.success || rows.length === 0) throw new HttpError(404, "shop_not_found", "No such shop in your warehouses.");
    return id.data;
  }

  router.get("/warehouses", async (req, res) => {
    const { rows } = await db.query<WarehouseOption>(
      "select id, code, name, district from public.warehouses where id = any($1::uuid[]) order by name",
      [actorOf(req).warehouseIds],
    );
    res.json({ items: rows });
  });

  // Applications and the shop directory. Scope always comes from the caller's assignments;
  // a warehouse filter can only narrow it.
  router.get("/shop-registrations", async (req, res) => {
    const { status, district, warehouseId } = registrationsQuery.parse(req.query);
    const { warehouseIds } = actorOf(req);
    if (warehouseId && !warehouseIds.includes(warehouseId)) {
      throw new HttpError(403, "forbidden_warehouse", "You are not assigned to that warehouse.");
    }

    const params: unknown[] = [warehouseId ? [warehouseId] : warehouseIds, status];
    let filters = "";
    if (district) {
      params.push(district);
      filters += ` and s.district = $${params.length}`;
    }
    const { rows } = await db.query<ShopRegistrationSummary>(
      `select s.id, s.fps_id as "fpsId", s.name, s.district, s.taluk, s.warehouse_id as "warehouseId",
              w.name as "warehouseName", s.status, s.created_at as "submittedAt",
              (select count(*)::int from public.stock_alerts a where a.shop_id = s.id and a.status = 'open') as "openAlerts"
         from public.shops s
         join public.warehouses w on w.id = s.warehouse_id
        where s.warehouse_id = any($1::uuid[]) and s.status = $2${filters}
        order by s.created_at`,
      params,
    );
    res.json({ items: rows });
  });

  router.get("/shops/:id", async (req, res) => {
    const shopId = await shopInScope(req);
    const [application, inventory, alerts] = await Promise.all([
      loadApplication(db, shopId),
      loadInventory(db, shopId),
      loadAlerts(db, { shopId }, "all"),
    ]);
    const detail: ShopDetail = { ...application!, inventory, alerts };
    res.json({ shop: detail });
  });

  router.post("/shops/:id/review", async (req, res) => {
    const shopId = await shopInScope(req);
    const { decision, reason } = reviewDecisionSchema.parse(req.body);
    // review_shop re-checks the reviewer's assignment and the pending state under a row lock.
    await db.query("select public.review_shop($1, $2, $3, $4)", [shopId, actorOf(req).id, decision, reason]);
    res.json({ application: await loadApplication(db, shopId) });
  });

  router.get("/alerts", async (req, res) => {
    const { status } = alertQuery.parse(req.query);
    res.json({ items: await loadAlerts(db, { warehouseIds: actorOf(req).warehouseIds }, status) });
  });

  router.get("/reviews", async (req, res) => {
    const { rows } = await db.query<ReviewHistoryItem>(
      `select r.id, r.decision, r.reason, p.full_name as "reviewerName", r.created_at as "createdAt",
              s.id as "shopId", s.name as "shopName", s.fps_id as "fpsId"
         from public.shop_reviews r
         join public.shops s on s.id = r.shop_id
         join public.profiles p on p.id = r.reviewer_id
        where s.warehouse_id = any($1::uuid[])
        order by r.created_at desc
        limit 100`,
      [actorOf(req).warehouseIds],
    );
    res.json({ items: rows });
  });

  return router;
}
