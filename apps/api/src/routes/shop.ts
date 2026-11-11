import {
  movementDelta,
  stockLevelsSchema,
  stockMovementSchema,
  type Commodity,
  type StockMovement,
} from "@rationsync/shared";
import { Router } from "express";
import { z } from "zod";
import { actorOf, requireApprovedShop } from "../auth.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { idempotencyKeyOf, idempotentWrite } from "../idempotency.js";
import { loadAlerts, loadInventory, loadMovement, movementColumns, movementJoins } from "../queries.js";

const historyQuery = z.object({
  commodity: z.string().regex(/^[A-Z_]{2,24}$/).optional(),
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const alertQuery = z.object({ status: z.enum(["open", "resolved", "all"]).default("open") });

// Cursor over (created_at, id) so rows written in the same instant are never skipped.
const encodeCursor = (m: StockMovement) => Buffer.from(`${new Date(m.createdAt).toISOString()}|${m.id}`).toString("base64url");
function decodeCursor(cursor: string): [string, string] {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!at || !id || Number.isNaN(Date.parse(at)) || !z.uuid().safeParse(id).success) {
    throw new HttpError(400, "invalid_cursor", "That page link is no longer valid.");
  }
  return [at, id];
}

export function shopRouter(db: Db): Router {
  const router = Router();
  router.use(requireApprovedShop);
  const shopIdOf = (req: Parameters<typeof actorOf>[0]) => actorOf(req).shop!.id;

  router.get("/inventory", async (req, res) => {
    res.json({ items: await loadInventory(db, shopIdOf(req)) });
  });

  router.get("/commodities", async (_req, res) => {
    const { rows } = await db.query<Commodity>(
      `select code, name_en as "nameEn", name_kn as "nameKn", unit from public.commodities order by sort_order`,
    );
    res.json({ items: rows });
  });

  router.patch("/inventory/:code/threshold", async (req, res) => {
    const { lowStockThreshold, targetStock } = stockLevelsSchema.parse(req.body);
    const code = z.string().regex(/^[A-Z_]{2,24}$/).parse(req.params.code);
    const shopId = shopIdOf(req);
    await db.query("select public.set_stock_levels($1, $2, $3, $4, $5)", [
      shopId,
      code,
      lowStockThreshold,
      targetStock ?? null,
      actorOf(req).id,
    ]);
    const item = (await loadInventory(db, shopId)).find((i) => i.commodityCode === code);
    res.json({ item });
  });

  router.get("/movements", async (req, res) => {
    const query = historyQuery.parse(req.query);
    const params: unknown[] = [shopIdOf(req)];
    let where = "m.shop_id = $1";
    if (query.commodity) {
      params.push(query.commodity);
      where += ` and m.commodity_code = $${params.length}`;
    }
    if (query.before) {
      params.push(...decodeCursor(query.before));
      where += ` and (m.created_at, m.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(query.limit + 1);
    const { rows } = await db.query<StockMovement>(
      `select ${movementColumns} ${movementJoins} where ${where}
        order by m.created_at desc, m.id desc limit $${params.length}`,
      params,
    );
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    res.json({ items, nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null });
  });

  // Opening balances, distributions and adjustments. Deliveries from a warehouse arrive only
  // through shipments, never as a free-form entry here.
  router.post("/movements", async (req, res) => {
    const key = idempotencyKeyOf(req);
    const input = stockMovementSchema.parse(req.body);
    const delta = movementDelta(input);
    const shopId = shopIdOf(req);

    const id = await idempotentWrite(
      async () =>
        (
          await db.query<{ id: string }>("select (public.apply_stock_movement($1, $2, $3, $4, $5, $6, $7)).id as id", [
            shopId,
            input.commodityCode,
            input.kind,
            delta,
            input.reason,
            actorOf(req).id,
            key,
          ])
        ).rows[0]!.id,
      "stock_movements_shop_id_idempotency_key_key",
      async () =>
        (
          await db.query<{ id: string }>("select id from public.stock_movements where shop_id = $1 and idempotency_key = $2", [
            shopId,
            key,
          ])
        ).rows[0]!.id,
    );

    const movement = (await loadMovement(db, id))!;
    if (movement.commodityCode !== input.commodityCode || movement.quantityDelta !== delta) {
      throw new HttpError(409, "idempotency_key_reused", "This Idempotency-Key was already used for a different movement.");
    }
    res.status(201).json({ movement });
  });

  router.get("/alerts", async (req, res) => {
    const { status } = alertQuery.parse(req.query);
    res.json({ items: await loadAlerts(db, { shopId: shopIdOf(req) }, status) });
  });

  return router;
}
