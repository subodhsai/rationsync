import {
  ACTIVE_SHIPMENT,
  AWAITING_RECEIPT,
  buildSuggestion,
  forecastCoverage,
  recommendPriority,
  type AppNotification,
  type CommodityAnalytics,
  type Forecast,
  type PriorityRecommendation,
  type ReconciliationRow,
  type ReplenishmentRequest,
  type ReplenishmentSuggestion,
  type RequestDetail,
  type RequestPriority,
  type RequestStatus,
  type ShipmentDetail,
  type ShipmentItem,
  type ShipmentStatus,
  type ShipmentSummary,
  type UsageHistory,
  type WarehouseMovement,
  type WarehouseOverview,
  type WarehouseStockItem,
} from "@rationsync/shared";
import { demoAlerts, demoCommodities, demoInventory, demoShopDetail, demoWarehouses, type DemoPersona } from "@/lib/fixtures";

// FICTIONAL PREVIEW DATA for Phase 3, consistent with lib/fixtures.ts: the Mysuru demo
// warehouse supplying Demo FPS Kuvempunagar (the shop persona) and Demo FPS Vijayanagar.
// Totals shown in preview are computed from these arrays, never typed in.

const MYS = demoWarehouses[1]!;
const K = { id: "0d9a0000-0000-4000-b000-000000000101", name: "Demo FPS Kuvempunagar", fpsId: "DEMO-FPS-MYS-0101" };
const V = { id: "0d9a0000-0000-4000-b000-000000000102", name: "Demo FPS Vijayanagar", fpsId: "DEMO-FPS-MYS-0102" };
const ADMIN = "Demo warehouse administrator";
const SHOP_ADMIN = "Demo shop administrator";
const commodity = (code: string) => demoCommodities.find((c) => c.code === code)!;

// Distribution history per shop and commodity. Kuvempunagar's mirrors its short fixture
// ledger (too little to estimate); Vijayanagar has a month of entries.
const usage: Record<string, UsageHistory> = {
  [`${K.id}:RICE`]: { distributed: 560, entries: 2, days: 9 },
  [`${K.id}:SUGAR`]: { distributed: 25, entries: 1, days: 9 },
  [`${V.id}:RICE`]: { distributed: 2280, entries: 16, days: 30 },
  [`${V.id}:WHEAT`]: { distributed: 610, entries: 9, days: 30 },
  [`${V.id}:RAGI`]: { distributed: 840, entries: 12, days: 30 },
  [`${V.id}:SUGAR`]: { distributed: 150, entries: 10, days: 30 },
};
const usageOf = (shopId: string, code: string): UsageHistory => usage[`${shopId}:${code}`] ?? { distributed: 0, entries: 0, days: 9 };

const shopStockOf = (shopId: string, code: string) =>
  (shopId === K.id ? demoInventory : demoShopDetail(shopId)?.inventory ?? []).find((i) => i.commodityCode === code);

type Seed = {
  n: number;
  shop: typeof K;
  code: string;
  requested: number;
  stockAtRequest: number;
  priority: RequestPriority;
  status: RequestStatus;
  reason: string;
  createdAt: string;
  approved?: number;
  received?: number;
  decisionReason?: string;
  decidedAt?: string;
  closedAt?: string;
  shipment?: string;
};

const ref = (prefix: string, n: number) => `${prefix}-${String(n).padStart(5, "0")}`;
// UUID-shaped like real records (the shared schemas validate ids): requests 8000, shipments 8100,
// shipment items 9000, discrepancies 9100.
const uuid = (kind: string, n: number) => `0d9a0000-0000-4000-${kind}-${String(n).padStart(12, "0")}`;

const seeds: Seed[] = [
  { n: 13, shop: V, code: "WHEAT", requested: 300, stockAtRequest: 0, priority: "urgent", status: "pending", reason: "Out of wheat since Thursday; card holders turned away", createdAt: "2026-11-09T17:20:00+05:30" },
  { n: 12, shop: V, code: "RICE", requested: 400, stockAtRequest: 960, priority: "normal", status: "pending", reason: "Stocking up before the festival week", createdAt: "2026-11-09T10:05:00+05:30" },
  { n: 11, shop: V, code: "RAGI", requested: 300, stockAtRequest: 160, priority: "high", status: "approved", approved: 250, reason: "Below threshold after the month-end rush", createdAt: "2026-11-06T12:30:00+05:30", decisionReason: "Partial: 250 kg now, keeping a buffer for other shops", decidedAt: "2026-11-07T09:40:00+05:30" },
  { n: 10, shop: K, code: "WHEAT", requested: 280, stockAtRequest: 120, priority: "high", status: "approved", approved: 280, reason: "Below threshold; target 400 kg", createdAt: "2026-11-05T15:10:00+05:30", decisionReason: "Stock available", decidedAt: "2026-11-06T10:00:00+05:30", shipment: uuid("8100", 5) },
  { n: 9, shop: V, code: "JOWAR", requested: 150, stockAtRequest: 0, priority: "normal", status: "approved", approved: 150, reason: "Adding jowar for households who asked for it", createdAt: "2026-11-04T11:00:00+05:30", decisionReason: "Stock available", decidedAt: "2026-11-05T16:20:00+05:30", shipment: uuid("8100", 6) },
  { n: 8, shop: V, code: "RAGI", requested: 200, stockAtRequest: 140, priority: "high", status: "partially_fulfilled", approved: 200, received: 180, reason: "Below threshold", createdAt: "2026-10-27T10:30:00+05:30", decisionReason: "Stock available", decidedAt: "2026-10-27T15:00:00+05:30", closedAt: "2026-10-30T12:15:00+05:30", shipment: uuid("8100", 4) },
  { n: 7, shop: V, code: "SUGAR", requested: 40, stockAtRequest: 45, priority: "normal", status: "fulfilled", approved: 40, received: 40, reason: "Below threshold", createdAt: "2026-10-24T09:50:00+05:30", decisionReason: "Stock available", decidedAt: "2026-10-24T13:10:00+05:30", closedAt: "2026-10-26T11:30:00+05:30", shipment: uuid("8100", 3) },
  { n: 6, shop: K, code: "RICE", requested: 500, stockAtRequest: 1900, priority: "normal", status: "rejected", reason: "Extra stock for the new month", createdAt: "2026-10-20T16:00:00+05:30", decisionReason: "Rice is well above the threshold; request again when it drops", decidedAt: "2026-10-21T10:30:00+05:30", closedAt: "2026-10-21T10:30:00+05:30" },
  { n: 5, shop: K, code: "SUGAR", requested: 30, stockAtRequest: 60, priority: "low", status: "cancelled", reason: "Top-up", createdAt: "2026-10-18T12:00:00+05:30", closedAt: "2026-10-18T12:20:00+05:30" },
];

type ShipmentSeed = {
  id: string;
  n: number;
  shop: typeof K;
  status: ShipmentStatus;
  expected: string;
  createdAt: string;
  dispatchedAt?: string;
  inTransitAt?: string;
  receivedAt?: string;
  receiptNote?: string;
  notes?: string;
  receipts?: Record<number, [number, number]>;
  resolved?: boolean;
};

const shipmentSeeds: ShipmentSeed[] = [
  { id: uuid("8100", 6), n: 6, shop: V, status: "preparing", expected: "2026-11-12", createdAt: "2026-11-09T11:30:00+05:30", notes: "Unload at the side gate; the shop has no loading bay" },
  { id: uuid("8100", 5), n: 5, shop: K, status: "in_transit", expected: "2026-11-11", createdAt: "2026-11-08T09:00:00+05:30", dispatchedAt: "2026-11-09T08:15:00+05:30", inTransitAt: "2026-11-09T08:40:00+05:30" },
  { id: uuid("8100", 4), n: 4, shop: V, status: "partially_received", expected: "2026-10-30", createdAt: "2026-10-28T10:00:00+05:30", dispatchedAt: "2026-10-29T08:00:00+05:30", receivedAt: "2026-10-30T12:15:00+05:30", receiptNote: "Three bags short on arrival, one torn", receipts: { 8: [180, 5] } },
  { id: uuid("8100", 3), n: 3, shop: V, status: "delivered", expected: "2026-10-26", createdAt: "2026-10-24T15:00:00+05:30", dispatchedAt: "2026-10-25T08:30:00+05:30", receivedAt: "2026-10-26T11:30:00+05:30", receipts: { 7: [40, 0] } },
];

function recommendationFor(shopId: string, code: string): { forecast: Forecast; recommendation: PriorityRecommendation; stock: RequestDetail["shopStock"] } {
  const stock = shopStockOf(shopId, code);
  const unit = commodity(code).unit;
  const onHand = stock?.quantity ?? 0;
  const forecast = forecastCoverage(onHand, usageOf(shopId, code), unit);
  return {
    forecast,
    recommendation: recommendPriority(onHand, stock?.lowStockThreshold ?? 0, forecast, unit),
    stock: stock ? { onHand, threshold: stock.lowStockThreshold, target: stock.targetStock } : null,
  };
}

export const demoRequests: ReplenishmentRequest[] = seeds.map((s) => {
  const c = commodity(s.code);
  const shipment = shipmentSeeds.find((x) => x.id === s.shipment);
  return {
    id: uuid("8000", s.n),
    reference: ref("RQ", s.n),
    shopId: s.shop.id,
    shopName: s.shop.name,
    fpsId: s.shop.fpsId,
    district: "Mysuru",
    warehouseId: MYS.id,
    warehouseName: MYS.name,
    commodityCode: s.code,
    commodityName: c.nameEn,
    unit: c.unit,
    requestedQuantity: s.requested,
    approvedQuantity: s.approved ?? null,
    receivedQuantity: s.received ?? null,
    stockAtRequest: s.stockAtRequest,
    suggestedQuantity: null,
    reason: s.reason,
    priority: s.priority,
    status: s.status,
    decisionReason: s.decisionReason ?? null,
    decidedByName: s.decidedAt ? ADMIN : null,
    decidedAt: s.decidedAt ?? null,
    requestedByName: SHOP_ADMIN,
    createdAt: s.createdAt,
    closedAt: s.closedAt ?? null,
    shipment: shipment ? { id: shipment.id, reference: ref("SH", shipment.n), status: shipment.status } : null,
    recommendation: recommendationFor(s.shop.id, s.code).recommendation,
  };
});

export function demoRequestDetail(id: string, scope: "shop" | "warehouse"): RequestDetail | ReplenishmentRequest | null {
  const request = demoRequests.find((r) => r.id === id && (scope === "warehouse" || r.shopId === K.id));
  if (!request) return null;
  if (scope === "shop") {
    const { recommendation: _r, ...forShop } = request;
    return forShop;
  }
  const { forecast, recommendation, stock } = recommendationFor(request.shopId, request.commodityCode);
  const wh = demoWarehouseStock.find((w) => w.commodityCode === request.commodityCode);
  return {
    ...request,
    forecast,
    recommendation,
    shopStock: stock,
    warehouseStock: wh ? { onHand: wh.onHand, reserved: wh.reserved, available: wh.available } : null,
  };
}

function shipmentItems(s: ShipmentSeed): ShipmentItem[] {
  return seeds
    .filter((r) => r.shipment === s.id)
    .map((r) => {
      const c = commodity(r.code);
      const receipt = s.receipts?.[r.n];
      const shortage = receipt ? r.approved! - receipt[0] - receipt[1] : 0;
      return {
        id: uuid("9000", r.n),
        requestId: uuid("8000", r.n),
        requestReference: ref("RQ", r.n),
        commodityCode: r.code,
        commodityName: c.nameEn,
        unit: c.unit,
        requestedQuantity: r.requested,
        approvedQuantity: r.approved!,
        quantity: r.approved!,
        receivedQuantity: receipt?.[0] ?? null,
        damagedQuantity: receipt?.[1] ?? null,
        discrepancy:
          receipt && (shortage > 0 || receipt[1] > 0)
            ? {
                id: uuid("9100", r.n),
                shortageQuantity: shortage,
                damagedQuantity: receipt[1],
                status: s.resolved ? "resolved" : "open",
                resolution: null,
                resolvedByName: null,
                resolvedAt: null,
              }
            : null,
      };
    });
}

export const demoShipmentDetails: ShipmentDetail[] = shipmentSeeds.map((s) => {
  const detailItems = shipmentItems(s);
  return {
    id: s.id,
    reference: ref("SH", s.n),
    status: s.status,
    warehouseId: MYS.id,
    warehouseName: MYS.name,
    shopId: s.shop.id,
    shopName: s.shop.name,
    fpsId: s.shop.fpsId,
    expectedDeliveryDate: s.expected,
    createdAt: s.createdAt,
    dispatchedAt: s.dispatchedAt ?? null,
    receivedAt: s.receivedAt ?? null,
    items: detailItems.map((i) => ({ commodityName: i.commodityName, quantity: i.quantity, unit: i.unit })),
    openDiscrepancies: detailItems.filter((i) => i.discrepancy?.status === "open").length,
    notes: s.notes ?? null,
    createdByName: ADMIN,
    dispatchedByName: s.dispatchedAt ? ADMIN : null,
    inTransitAt: s.inTransitAt ?? null,
    receivedByName: s.receivedAt ? SHOP_ADMIN : null,
    receiptNote: s.receiptNote ?? null,
    disputedAt: null,
    disputeReason: null,
    cancelledAt: null,
    cancelReason: null,
    detailItems,
  };
});

export const demoShipments: ShipmentSummary[] = demoShipmentDetails.map(
  ({ notes: _n, createdByName: _c, dispatchedByName: _d, inTransitAt: _t, receivedByName: _r, receiptNote: _rn,
     disputedAt: _da, disputeReason: _dr, cancelledAt: _ca, cancelReason: _cr, detailItems: _i, ...summary }) => summary,
);

// Warehouse stock: opening balances, one receipt, and the dispatches above. Reserved is the
// approved requests not yet dispatched (RQ-00011 and RQ-00009).
const dispatched = (code: string) =>
  demoShipmentDetails
    .filter((s) => s.dispatchedAt)
    .flatMap((s) => s.detailItems)
    .filter((i) => i.commodityCode === code)
    .reduce((sum, i) => sum + i.quantity, 0);
const inTransit = (code: string) =>
  demoShipmentDetails
    .filter((s) => AWAITING_RECEIPT.includes(s.status))
    .flatMap((s) => s.detailItems)
    .filter((i) => i.commodityCode === code)
    .reduce((sum, i) => sum + i.quantity, 0);
const reserved = (code: string) =>
  demoRequests
    .filter((r) => r.status === "approved" && r.commodityCode === code && (!r.shipment || r.shipment.status === "preparing"))
    .reduce((sum, r) => sum + (r.approvedQuantity ?? 0), 0);

const warehouseOpening: Array<[string, number, number]> = [
  ["RICE", 16000, 5000],
  ["WHEAT", 2400, 1000],
  ["RAGI", 5200, 1500],
  ["JOWAR", 600, 1000],
  ["SUGAR", 900, 400],
];
const RICE_RECEIPT = 2000;

export const demoWarehouseStock: WarehouseStockItem[] = warehouseOpening.map(([code, opening, threshold]) => {
  const c = commodity(code);
  const onHand = opening + (code === "RICE" ? RICE_RECEIPT : 0) - dispatched(code);
  return {
    warehouseId: MYS.id,
    warehouseName: MYS.name,
    commodityCode: code,
    nameEn: c.nameEn,
    nameKn: c.nameKn,
    unit: c.unit,
    onHand,
    reserved: reserved(code),
    available: onHand - reserved(code),
    inTransit: inTransit(code),
    lowStockThreshold: threshold,
    updatedAt: "2026-11-09T08:15:00+05:30",
  };
});

export const demoWarehouseMovements: WarehouseMovement[] = (() => {
  const rows: Array<Omit<WarehouseMovement, "id" | "balanceAfter">> = [];
  const add = (code: string, kind: WarehouseMovement["kind"], delta: number, reason: string, createdAt: string, reference: string | null = null, shipmentId: string | null = null) => {
    const c = commodity(code);
    rows.push({ warehouseId: MYS.id, commodityCode: code, commodityName: c.nameEn, unit: c.unit, kind, quantityDelta: delta, reason, reference, shipmentId, actorName: kind === "opening_balance" ? null : ADMIN, createdAt });
  };
  for (const [code, opening] of warehouseOpening) add(code, "opening_balance", opening, "Demo opening balance", "2026-10-01T09:00:00+05:30");
  for (const s of [...demoShipmentDetails].reverse().filter((x) => x.dispatchedAt)) {
    for (const i of s.detailItems) add(i.commodityCode, "dispatch", -i.quantity, `Dispatched to ${s.fpsId}`, s.dispatchedAt!, s.reference, s.id);
  }
  add("RICE", "receipt", RICE_RECEIPT, "Lorry from the district depot", "2026-11-03T14:00:00+05:30", "DEMO-CHALLAN-0042");
  rows.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const balance: Record<string, number> = {};
  return rows
    .map((r, i) => ({ ...r, id: `wm${i + 1}`, balanceAfter: (balance[r.commodityCode] = (balance[r.commodityCode] ?? 0) + r.quantityDelta) }))
    .reverse();
})();

// Shop persona views ---------------------------------------------------------

export const demoShopRequests = demoRequests.filter((r) => r.shopId === K.id).map(({ recommendation: _r, ...r }) => r);
export const demoShopShipments = demoShipments.filter((s) => s.shopId === K.id && s.status !== "preparing" && s.status !== "cancelled");

export const demoSuggestions: ReplenishmentSuggestion[] = demoInventory.map((item) => {
  const open = demoShopRequests.find((r) => r.commodityCode === item.commodityCode && (r.status === "pending" || r.status === "approved"));
  return buildSuggestion(
    item,
    open ? { id: open.id, reference: open.reference, status: open.status, quantity: open.approvedQuantity ?? open.requestedQuantity } : null,
    usageOf(K.id, item.commodityCode),
  );
});

// Derived warehouse views -----------------------------------------------------

export function demoWarehouseOverview(today: string): WarehouseOverview {
  const pending = demoRequests.filter((r) => r.status === "pending");
  const awaiting = demoShipments.filter((s) => AWAITING_RECEIPT.includes(s.status));
  return {
    pendingRequests: pending.length,
    urgentRequests: pending.filter((r) => r.recommendation?.priority === "urgent").length,
    activeShipments: demoShipments.filter((s) => ACTIVE_SHIPMENT.includes(s.status)).length,
    awaitingReceipt: awaiting.length,
    overdueShipments: awaiting.filter((s) => s.expectedDeliveryDate < today).length,
    lowStockShops: new Set(demoAlerts.filter((a) => a.status === "open").map((a) => a.shopId)).size,
    openDiscrepancies: demoShipments.reduce((n, s) => n + s.openDiscrepancies, 0),
    lowWarehouseStock: demoWarehouseStock.filter((w) => w.available <= w.lowStockThreshold).length,
  };
}

export const demoReconciliation: ReconciliationRow[] = demoRequests
  .filter((r) => r.approvedQuantity !== null)
  .map((r) => {
    const shipment = demoShipmentDetails.find((s) => s.id === r.shipment?.id);
    const item = shipment?.detailItems.find((i) => i.requestId === r.id);
    const received = item?.receivedQuantity ?? null;
    return {
      requestId: r.id,
      requestReference: r.reference,
      shipmentId: shipment?.id ?? null,
      shipmentReference: shipment?.reference ?? null,
      shipmentStatus: shipment?.status ?? null,
      shopName: r.shopName,
      fpsId: r.fpsId,
      commodityName: r.commodityName,
      unit: r.unit,
      requested: r.requestedQuantity,
      approved: r.approvedQuantity!,
      dispatched: shipment?.dispatchedAt ? item!.quantity : null,
      received,
      damaged: item?.damagedQuantity ?? null,
      shortage: item && received !== null ? item.quantity - received - (item.damagedQuantity ?? 0) : null,
      discrepancyStatus: item?.discrepancy?.status ?? null,
    };
  })
  .sort((a, b) => Number(b.discrepancyStatus === "open") - Number(a.discrepancyStatus === "open"));

export const demoAnalytics: CommodityAnalytics[] = demoWarehouseStock.map((w) => {
  const shopRows = [K.id, V.id].map((id) => shopStockOf(id, w.commodityCode)).filter((i) => i !== undefined);
  const histories = [K.id, V.id].map((id) => usageOf(id, w.commodityCode));
  const regional: UsageHistory = {
    distributed: histories.reduce((n, h) => n + h.distributed, 0),
    entries: histories.reduce((n, h) => n + h.entries, 0),
    days: Math.max(...histories.map((h) => h.days)),
  };
  const shopStock = shopRows.reduce((n, i) => n + i.quantity, 0);
  return {
    commodityCode: w.commodityCode,
    nameEn: w.nameEn,
    unit: w.unit,
    warehouseOnHand: w.onHand,
    warehouseReserved: w.reserved,
    warehouseAvailable: w.available,
    inTransit: w.inTransit,
    shopStock,
    shopsStocking: shopRows.length,
    shopsLow: shopRows.filter((i) => i.quantity <= i.lowStockThreshold).length,
    usage: regional,
    forecast: forecastCoverage(w.onHand + w.inTransit + shopStock, regional, w.unit),
  };
});

export const demoNotifications: Partial<Record<DemoPersona, AppNotification[]>> = {
  shop: [
    { id: "n4", kind: "shipment.dispatched", title: "SH-00005 is on its way", body: "Expected by 11 Nov 2026. Confirm the quantities that arrive.", createdAt: "2026-11-09T08:15:00+05:30", readAt: null },
    { id: "n3", kind: "stock.low", title: "Sugar is at or below its threshold", body: "35 kg left. Threshold 50 kg.", createdAt: "2026-11-08T10:15:00+05:30", readAt: null },
    { id: "n2", kind: "request.decided", title: "RQ-00010 approved", body: "Stock available", createdAt: "2026-11-06T10:00:00+05:30", readAt: "2026-11-06T12:00:00+05:30" },
    { id: "n1", kind: "request.decided", title: "RQ-00006 was not approved", body: "Rice is well above the threshold; request again when it drops", createdAt: "2026-10-21T10:30:00+05:30", readAt: "2026-10-21T11:00:00+05:30" },
  ],
  warehouse: [
    { id: "w4", kind: "request.submitted", title: "Demo FPS Vijayanagar requested 300 kg of wheat", body: "RQ-00013, urgent priority. Out of wheat since Thursday; card holders turned away", createdAt: "2026-11-09T17:20:00+05:30", readAt: null },
    { id: "w3", kind: "request.submitted", title: "Demo FPS Vijayanagar requested 400 kg of rice", body: "RQ-00012, normal priority. Stocking up before the festival week", createdAt: "2026-11-09T10:05:00+05:30", readAt: null },
    { id: "w2", kind: "stock.low", title: "Demo FPS Kuvempunagar: Sugar at or below threshold", body: "DEMO-FPS-MYS-0101 has 35 kg of sugar left. Threshold 50 kg.", createdAt: "2026-11-08T10:15:00+05:30", readAt: null },
    { id: "w1", kind: "shipment.discrepancy", title: "SH-00004 received with 1 discrepancy", body: "Three bags short on arrival, one torn", createdAt: "2026-10-30T12:15:00+05:30", readAt: "2026-10-30T15:00:00+05:30" },
  ],
};
