import type { AlertStatus, InventoryItem, ShopApplication, StockAlert, StockMovement } from "@rationsync/shared";
import type { Db } from "./db.js";

// Read queries shared by the shop and warehouse routes. Callers enforce scope first.

export async function loadApplication(db: Db, shopId: string): Promise<ShopApplication | null> {
  const { rows } = await db.query<ShopApplication>(
    `select s.id, s.fps_id as "fpsId", s.name, s.district, s.taluk, s.address, s.pin_code as "pinCode",
            s.contact_phone as "contactPhone", s.contact_email as "contactEmail", s.status,
            s.review_reason as "reviewReason", s.reviewed_at as "reviewedAt",
            s.created_at as "submittedAt", s.updated_at as "updatedAt",
            json_build_object('id', w.id, 'code', w.code, 'name', w.name, 'district', w.district) as warehouse,
            coalesce((select json_agg(json_build_object(
                        'id', d.id, 'fileName', d.file_name, 'contentType', d.content_type,
                        'sizeBytes', d.size_bytes, 'storagePath', d.storage_path, 'uploadedAt', d.created_at)
                        order by d.created_at)
                        from public.shop_documents d where d.shop_id = s.id), '[]') as documents,
            coalesce((select json_agg(json_build_object(
                        'id', r.id, 'decision', r.decision, 'reason', r.reason,
                        'reviewerName', p.full_name, 'createdAt', r.created_at)
                        order by r.created_at desc)
                        from public.shop_reviews r join public.profiles p on p.id = r.reviewer_id
                       where r.shop_id = s.id), '[]') as reviews
       from public.shops s
       join public.warehouses w on w.id = s.warehouse_id
      where s.id = $1`,
    [shopId],
  );
  return rows[0] ?? null;
}

export async function loadInventory(db: Db, shopId: string): Promise<InventoryItem[]> {
  const { rows } = await db.query<InventoryItem>(
    `select c.code as "commodityCode", c.name_en as "nameEn", c.name_kn as "nameKn", c.unit,
            i.quantity::float8 as quantity, i.low_stock_threshold::float8 as "lowStockThreshold", i.updated_at as "updatedAt"
       from public.shop_inventory i
       join public.commodities c on c.code = i.commodity_code
      where i.shop_id = $1
      order by c.sort_order`,
    [shopId],
  );
  return rows;
}

export const movementColumns = `
  m.id, m.commodity_code as "commodityCode", c.name_en as "commodityName", c.unit, m.kind,
  m.quantity_delta::float8 as "quantityDelta", m.balance_after::float8 as "balanceAfter",
  m.reason, m.reference, nullif(p.full_name, '') as "actorName", m.created_at as "createdAt"`;

export const movementJoins = `
  from public.stock_movements m
  join public.commodities c on c.code = m.commodity_code
  left join public.profiles p on p.id = m.actor_id`;

export async function loadMovement(db: Db, id: string): Promise<StockMovement | null> {
  const { rows } = await db.query<StockMovement>(`select ${movementColumns} ${movementJoins} where m.id = $1`, [id]);
  return rows[0] ?? null;
}

type AlertScope = { shopId: string } | { warehouseIds: string[] };

// Open alerts first, the most urgent (lowest share of threshold remaining) at the top.
export async function loadAlerts(db: Db, scope: AlertScope, status: AlertStatus | "all"): Promise<StockAlert[]> {
  const scopeSql = "shopId" in scope ? "a.shop_id = $1" : "s.warehouse_id = any($1::uuid[])";
  const { rows } = await db.query<StockAlert>(
    `select a.id, a.shop_id as "shopId", s.name as "shopName", s.fps_id as "fpsId",
            a.commodity_code as "commodityCode", c.name_en as "commodityName", c.unit, a.status,
            a.quantity_at_open::float8 as "quantityAtOpen", a.threshold_at_open::float8 as "thresholdAtOpen",
            i.quantity::float8 as "currentQuantity", i.low_stock_threshold::float8 as "currentThreshold",
            a.opened_at as "openedAt", a.resolved_at as "resolvedAt"
       from public.stock_alerts a
       join public.shops s on s.id = a.shop_id
       join public.commodities c on c.code = a.commodity_code
       join public.shop_inventory i on i.shop_id = a.shop_id and i.commodity_code = a.commodity_code
      where ${scopeSql} and ($2::text = 'all' or a.status::text = $2)
      order by (a.status = 'open') desc,
               case when a.status = 'open' then i.quantity / nullif(i.low_stock_threshold, 0) end asc nulls first,
               coalesce(a.resolved_at, a.opened_at) desc
      limit 200`,
    ["shopId" in scope ? scope.shopId : scope.warehouseIds, status],
  );
  return rows;
}
