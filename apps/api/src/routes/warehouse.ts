import type { ShopRegistrationSummary } from "@rationsync/shared";
import { Router } from "express";
import { z } from "zod";
import { actorOf, requireRole } from "../auth.js";
import type { Db } from "../db.js";

const registrationsQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
});

export function warehouseRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("warehouse_admin"));

  // Scoped to the warehouses this administrator is assigned to.
  router.get("/shop-registrations", async (req, res) => {
    const { status } = registrationsQuery.parse(req.query);
    const { rows } = await db.query<ShopRegistrationSummary>(
      `select s.id, s.fps_id as "fpsId", s.name, s.district, s.taluk,
              w.name as "warehouseName", s.status, s.created_at as "submittedAt"
         from public.shops s
         join public.warehouses w on w.id = s.warehouse_id
        where s.warehouse_id = any($1::uuid[]) and s.status = $2
        order by s.created_at`,
      [actorOf(req).warehouseIds, status],
    );
    res.json({ items: rows });
  });

  return router;
}
