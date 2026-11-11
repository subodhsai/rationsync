import {
  FORECAST_WINDOW_DAYS,
  forecastCoverage,
  recommendPriority,
  type Forecast,
  type PriorityRecommendation,
  type ReplenishmentRequest,
  type ShipmentDetail,
  type ShipmentSummary,
  type UsageHistory,
  type WarehouseStockItem,
} from "@rationsync/shared";
import type { Db } from "./db.js";

// Phase 3 read queries. Callers enforce role and scope before using them.

/**
 * Distribution history for one shop commodity: the quantity and number of distributions in
 * the forecast window, and how many whole days of ledger history exist (capped at the window).
 */
export const usageLateral = (shopColumn: string, commodityColumn: string, alias = "u") => `
  left join lateral (
    select coalesce(sum(-m.quantity_delta) filter (where m.kind = 'distribution'
                      and m.created_at > now() - interval '${FORECAST_WINDOW_DAYS} days'), 0)::float8 as distributed,
           (count(*) filter (where m.kind = 'distribution'
                      and m.created_at > now() - interval '${FORECAST_WINDOW_DAYS} days'))::int as entries,
           coalesce(least(${FORECAST_WINDOW_DAYS}, floor(extract(epoch from now() - min(m.created_at)) / 86400)), 0)::int as days
      from public.stock_movements m
     where m.shop_id = ${shopColumn} and m.commodity_code = ${commodityColumn}
  ) ${alias} on true`;

const requestColumns = `
  r.id, public.request_reference(r.number) as reference, r.shop_id as "shopId", s.name as "shopName",
  s.fps_id as "fpsId", s.district, r.warehouse_id as "warehouseId", w.name as "warehouseName",
  r.commodity_code as "commodityCode", c.name_en as "commodityName", c.unit,
  r.requested_quantity::float8 as "requestedQuantity", r.approved_quantity::float8 as "approvedQuantity",
  r.received_quantity::float8 as "receivedQuantity", r.stock_at_request::float8 as "stockAtRequest",
  r.suggested_quantity::float8 as "suggestedQuantity", r.reason, r.priority, r.status,
  r.decision_reason as "decisionReason", nullif(dp.full_name, '') as "decidedByName", r.decided_at as "decidedAt",
  nullif(rp.full_name, '') as "requestedByName", r.created_at as "createdAt", r.closed_at as "closedAt",
  (select json_build_object('id', sh.id, 'reference', public.shipment_reference(sh.number), 'status', sh.status)
     from public.shipment_items si join public.shipments sh on sh.id = si.shipment_id
    where si.request_id = r.id and sh.status <> 'cancelled' limit 1) as shipment,
  i.quantity::float8 as "shopOnHand", i.low_stock_threshold::float8 as "shopThreshold",
  i.target_stock::float8 as "shopTarget", u.distributed, u.entries, u.days`;

const requestFrom = `
  from public.replenishment_requests r
  join public.shops s on s.id = r.shop_id
  join public.warehouses w on w.id = r.warehouse_id
  join public.commodities c on c.code = r.commodity_code
  left join public.profiles dp on dp.id = r.decided_by
  left join public.profiles rp on rp.id = r.requested_by
  left join public.shop_inventory i on i.shop_id = r.shop_id and i.commodity_code = r.commodity_code
  ${usageLateral("r.shop_id", "r.commodity_code")}`;

type RequestRow = Omit<ReplenishmentRequest, "recommendation"> &
  UsageHistory & { shopOnHand: number | null; shopThreshold: number | null; shopTarget: number | null };

export interface LoadedRequest extends ReplenishmentRequest {
  recommendation: PriorityRecommendation;
  forecast: Forecast;
  shopStock: { onHand: number; threshold: number; target: number | null } | null;
}

/** Requests with the recommended priority worked out from the shop's current stock and usage. */
export async function loadRequests(db: Db, where: string, params: unknown[], tail = "order by r.created_at desc"): Promise<LoadedRequest[]> {
  const { rows } = await db.query<RequestRow>(`select ${requestColumns} ${requestFrom} where ${where} ${tail}`, params);
  return rows.map(({ shopOnHand, shopThreshold, shopTarget, distributed, entries, days, ...request }) => {
    const onHand = shopOnHand ?? 0;
    const forecast = forecastCoverage(onHand, { distributed, entries, days }, request.unit);
    return {
      ...request,
      forecast,
      recommendation: recommendPriority(onHand, shopThreshold ?? 0, forecast, request.unit),
      shopStock: shopOnHand === null ? null : { onHand, threshold: shopThreshold ?? 0, target: shopTarget },
    };
  });
}

/** The shape a shop sees: no internal recommendation fields. */
export const forShop = ({ recommendation: _r, forecast: _f, shopStock: _s, ...request }: LoadedRequest): ReplenishmentRequest =>
  request;

const shipmentColumns = `
  sh.id, public.shipment_reference(sh.number) as reference, sh.status, sh.warehouse_id as "warehouseId",
  w.name as "warehouseName", sh.shop_id as "shopId", s.name as "shopName", s.fps_id as "fpsId",
  sh.expected_delivery_date::text as "expectedDeliveryDate", sh.created_at as "createdAt",
  sh.dispatched_at as "dispatchedAt", sh.received_at as "receivedAt",
  coalesce((select json_agg(json_build_object('commodityName', c.name_en, 'quantity', si.quantity::float8, 'unit', c.unit)
                            order by c.sort_order)
              from public.shipment_items si join public.commodities c on c.code = si.commodity_code
             where si.shipment_id = sh.id), '[]') as items,
  (select count(*)::int from public.delivery_discrepancies d where d.shipment_id = sh.id and d.status = 'open')
    as "openDiscrepancies"`;

const shipmentFrom = `
  from public.shipments sh
  join public.shops s on s.id = sh.shop_id
  join public.warehouses w on w.id = sh.warehouse_id`;

export async function loadShipments(db: Db, where: string, params: unknown[], tail: string): Promise<ShipmentSummary[]> {
  const { rows } = await db.query<ShipmentSummary>(`select ${shipmentColumns} ${shipmentFrom} where ${where} ${tail}`, params);
  return rows;
}

export async function loadShipmentDetail(db: Db, id: string): Promise<ShipmentDetail | null> {
  const { rows } = await db.query<ShipmentDetail>(
    `select ${shipmentColumns}, sh.notes, nullif(cp.full_name, '') as "createdByName",
            nullif(dp.full_name, '') as "dispatchedByName", sh.in_transit_at as "inTransitAt",
            nullif(rp.full_name, '') as "receivedByName", sh.receipt_note as "receiptNote",
            sh.disputed_at as "disputedAt", sh.dispute_reason as "disputeReason",
            sh.cancelled_at as "cancelledAt", sh.cancel_reason as "cancelReason",
            coalesce((select json_agg(json_build_object(
                        'id', si.id, 'requestId', r.id, 'requestReference', public.request_reference(r.number),
                        'commodityCode', si.commodity_code, 'commodityName', c.name_en, 'unit', c.unit,
                        'requestedQuantity', r.requested_quantity::float8, 'approvedQuantity', r.approved_quantity::float8,
                        'quantity', si.quantity::float8, 'receivedQuantity', si.received_quantity::float8,
                        'damagedQuantity', si.damaged_quantity::float8,
                        'discrepancy', case when d.id is null then null else json_build_object(
                          'id', d.id, 'shortageQuantity', d.shortage_quantity::float8,
                          'damagedQuantity', d.damaged_quantity::float8, 'status', d.status,
                          'resolution', d.resolution, 'resolvedByName', nullif(vp.full_name, ''),
                          'resolvedAt', d.resolved_at) end)
                        order by c.sort_order)
                        from public.shipment_items si
                        join public.replenishment_requests r on r.id = si.request_id
                        join public.commodities c on c.code = si.commodity_code
                        left join public.delivery_discrepancies d on d.shipment_item_id = si.id
                        left join public.profiles vp on vp.id = d.resolved_by
                       where si.shipment_id = sh.id), '[]') as "detailItems"
       ${shipmentFrom}
       left join public.profiles cp on cp.id = sh.created_by
       left join public.profiles dp on dp.id = sh.dispatched_by
       left join public.profiles rp on rp.id = sh.received_by
      where sh.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function loadWarehouseStock(db: Db, warehouseIds: string[]): Promise<WarehouseStockItem[]> {
  const { rows } = await db.query<WarehouseStockItem>(
    `select wi.warehouse_id as "warehouseId", w.name as "warehouseName", c.code as "commodityCode",
            c.name_en as "nameEn", c.name_kn as "nameKn", c.unit,
            wi.quantity_on_hand::float8 as "onHand", wi.quantity_reserved::float8 as reserved,
            (wi.quantity_on_hand - wi.quantity_reserved)::float8 as available,
            coalesce((select sum(si.quantity) from public.shipment_items si join public.shipments sh on sh.id = si.shipment_id
                       where sh.warehouse_id = wi.warehouse_id and si.commodity_code = wi.commodity_code
                         and sh.status in ('dispatched', 'in_transit', 'disputed')), 0)::float8 as "inTransit",
            wi.low_stock_threshold::float8 as "lowStockThreshold", wi.updated_at as "updatedAt"
       from public.warehouse_inventory wi
       join public.warehouses w on w.id = wi.warehouse_id
       join public.commodities c on c.code = wi.commodity_code
      where wi.warehouse_id = any($1::uuid[])
      order by w.name, c.sort_order`,
    [warehouseIds],
  );
  return rows;
}

/** Offset pagination for warehouse lists. */
export const PAGE_SIZE = 25;
export function paginate<T>(rows: T[], page: number) {
  const start = (page - 1) * PAGE_SIZE;
  return { items: rows.slice(start, start + PAGE_SIZE), page, total: rows.length, pageSize: PAGE_SIZE };
}
