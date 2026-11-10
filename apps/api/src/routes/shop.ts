import type { InventoryItem } from "@rationsync/shared";
import { Router } from "express";
import { actorOf, requireApprovedShop } from "../auth.js";
import type { Db } from "../db.js";

export function shopRouter(db: Db): Router {
  const router = Router();
  router.use(requireApprovedShop);

  router.get("/inventory", async (req, res) => {
    const shopId = actorOf(req).shop!.id;
    const { rows } = await db.query<InventoryItem>(
      `select c.code as "commodityCode", c.name_en as "nameEn", c.name_kn as "nameKn", c.unit,
              i.quantity::float8 as quantity, i.low_stock_threshold::float8 as "lowStockThreshold", i.updated_at as "updatedAt"
         from public.shop_inventory i
         join public.commodities c on c.code = i.commodity_code
        where i.shop_id = $1
        order by c.sort_order`,
      [shopId],
    );
    res.json({ items: rows });
  });

  return router;
}
