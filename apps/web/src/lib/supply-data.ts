import "server-only";
import {
  ACTIVE_SHIPMENT,
  AWAITING_RECEIPT,
  priorityRank,
  type AppNotification,
  type CommodityAnalytics,
  type Page,
  type ReconciliationRow,
  type ReplenishmentRequest,
  type ReplenishmentSuggestion,
  type RequestDetail,
  type RequestPriority,
  type RequestStatus,
  type ShipmentDetail,
  type ShipmentSummary,
  type WarehouseMovement,
  type WarehouseOverviewResponse,
  type WarehouseStockItem,
} from "@rationsync/shared";
import { connection } from "next/server";
import { ApiError, apiGet } from "@/lib/api";
import {
  demoAnalytics,
  demoNotifications,
  demoReconciliation,
  demoRequestDetail,
  demoRequests,
  demoShipmentDetails,
  demoShipments,
  demoShopRequests,
  demoShopShipments,
  demoSuggestions,
  demoWarehouseMovements,
  demoWarehouseOverview,
  demoWarehouseStock,
} from "@/lib/supply-fixtures";
import type { Session } from "@/lib/session";

// Phase 3 loaders: fixtures in preview mode, the Render API otherwise, same shared types.

type Live = Extract<Session, { mode: "live" }>;
const live = <T>(session: Live, path: string) => apiGet<T>(path, session.accessToken);
const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)]);
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
};
async function orNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
const PAGE_SIZE = 25;
const pageOf = <T>(rows: T[], page: number): Page<T> => ({
  items: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  page,
  total: rows.length,
  pageSize: PAGE_SIZE,
});

// Shop administrator ----------------------------------------------------------

export type ShopRequestTab = "open" | "closed" | "all";
const isOpen = (r: ReplenishmentRequest) => r.status === "pending" || r.status === "approved";

export async function getShopRequests(session: Session, status: ShopRequestTab): Promise<ReplenishmentRequest[]> {
  if (session.mode === "demo") return demoShopRequests.filter((r) => status === "all" || isOpen(r) === (status === "open"));
  return (await live<{ items: ReplenishmentRequest[] }>(session, `/api/v1/shop/requests?status=${status}`)).items;
}

export async function getShopRequest(session: Session, id: string): Promise<ReplenishmentRequest | null> {
  if (session.mode === "demo") return demoRequestDetail(id, "shop");
  return orNull(async () => (await live<{ request: ReplenishmentRequest }>(session, `/api/v1/shop/requests/${encodeURIComponent(id)}`)).request);
}

export async function getSuggestions(session: Session): Promise<ReplenishmentSuggestion[]> {
  if (session.mode === "demo") return demoSuggestions;
  return (await live<{ items: ReplenishmentSuggestion[] }>(session, "/api/v1/shop/suggestions")).items;
}

export type ShopShipmentTab = "incoming" | "received" | "all";

export async function getShopShipments(session: Session, status: ShopShipmentTab): Promise<ShipmentSummary[]> {
  if (session.mode === "demo") {
    return demoShopShipments.filter(
      (s) => status === "all" || AWAITING_RECEIPT.includes(s.status) === (status === "incoming"),
    );
  }
  return (await live<{ items: ShipmentSummary[] }>(session, `/api/v1/shop/shipments?status=${status}`)).items;
}

export async function getShopShipment(session: Session, id: string): Promise<ShipmentDetail | null> {
  if (session.mode === "demo") {
    return demoShipmentDetails.find((s) => s.id === id && demoShopShipments.some((x) => x.id === id)) ?? null;
  }
  return orNull(async () => (await live<{ shipment: ShipmentDetail }>(session, `/api/v1/shop/shipments/${encodeURIComponent(id)}`)).shipment);
}

// Both roles ------------------------------------------------------------------

export async function getNotifications(session: Session): Promise<{ items: AppNotification[]; unread: number }> {
  if (session.mode === "demo") {
    const items = demoNotifications[session.persona] ?? [];
    return { items, unread: items.filter((n) => !n.readAt).length };
  }
  return live(session, "/api/v1/notifications");
}

// Warehouse administrator -----------------------------------------------------

export async function getWarehouseOverview(session: Session): Promise<WarehouseOverviewResponse> {
  if (session.mode === "demo") {
    await connection(); // overdue depends on today's date
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    return {
      metrics: demoWarehouseOverview(today),
      requests: demoRequests.filter((r) => r.status === "pending").sort(byRecommendation).slice(0, 5),
      shipments: demoShipments
        .filter((s) => AWAITING_RECEIPT.includes(s.status))
        .sort((a, b) => a.expectedDeliveryDate.localeCompare(b.expectedDeliveryDate))
        .slice(0, 5),
    };
  }
  return live(session, "/api/v1/warehouse/overview");
}

export async function getWarehouseStock(session: Session): Promise<WarehouseStockItem[]> {
  if (session.mode === "demo") return demoWarehouseStock;
  return (await live<{ items: WarehouseStockItem[] }>(session, "/api/v1/warehouse/inventory")).items;
}

export async function getWarehouseMovements(
  session: Session,
  { warehouseId, commodity, page = 1 }: { warehouseId?: string; commodity?: string; page?: number },
): Promise<{ items: WarehouseMovement[]; page: number; hasMore: boolean }> {
  if (session.mode === "demo") {
    const rows = demoWarehouseMovements.filter(
      (m) => (!warehouseId || m.warehouseId === warehouseId) && (!commodity || m.commodityCode === commodity),
    );
    return { items: rows.slice((page - 1) * 25, page * 25), page, hasMore: rows.length > page * 25 };
  }
  return live(session, `/api/v1/warehouse/movements${qs({ warehouseId, commodity, page })}`);
}

export type RequestFilters = {
  status: RequestStatus | "all";
  priority?: RequestPriority;
  commodity?: string;
  district?: string;
  shopId?: string;
  q?: string;
  sort: "recommended" | "oldest" | "newest";
  page: number;
};

const byRecommendation = (a: ReplenishmentRequest, b: ReplenishmentRequest) =>
  priorityRank[a.recommendation?.priority ?? "low"] - priorityRank[b.recommendation?.priority ?? "low"] ||
  Date.parse(a.createdAt) - Date.parse(b.createdAt);

export async function getWarehouseRequests(session: Session, f: RequestFilters): Promise<Page<ReplenishmentRequest>> {
  if (session.mode === "demo") {
    const q = f.q?.toLowerCase();
    const rows = demoRequests.filter(
      (r) =>
        (f.status === "all" || r.status === f.status) &&
        (!f.priority || r.priority === f.priority) &&
        (!f.commodity || r.commodityCode === f.commodity) &&
        (!f.district || r.district === f.district) &&
        (!f.shopId || r.shopId === f.shopId) &&
        (!q || [r.shopName, r.fpsId, r.reference].some((v) => v.toLowerCase().includes(q))),
    );
    if (f.sort === "recommended") rows.sort(byRecommendation);
    if (f.sort === "oldest") rows.reverse();
    return pageOf(rows, f.page);
  }
  return live(session, `/api/v1/warehouse/requests${qs(f)}`);
}

export async function getWarehouseRequest(session: Session, id: string): Promise<RequestDetail | null> {
  if (session.mode === "demo") return demoRequestDetail(id, "warehouse") as RequestDetail | null;
  return orNull(async () => (await live<{ request: RequestDetail }>(session, `/api/v1/warehouse/requests/${encodeURIComponent(id)}`)).request);
}

export type ShipmentTab = "active" | "awaiting_receipt" | "closed" | "all";

export async function getWarehouseShipments(
  session: Session,
  { status, shopId, page }: { status: ShipmentTab; shopId?: string; page: number },
): Promise<Page<ShipmentSummary>> {
  if (session.mode === "demo") {
    const sets: Record<ShipmentTab, string[] | null> = {
      active: ACTIVE_SHIPMENT,
      awaiting_receipt: AWAITING_RECEIPT,
      closed: ["delivered", "partially_received", "cancelled"],
      all: null,
    };
    const set = sets[status];
    return pageOf(demoShipments.filter((s) => (!set || set.includes(s.status)) && (!shopId || s.shopId === shopId)), page);
  }
  return live(session, `/api/v1/warehouse/shipments${qs({ status, shopId, page })}`);
}

export async function getWarehouseShipment(session: Session, id: string): Promise<ShipmentDetail | null> {
  if (session.mode === "demo") return demoShipmentDetails.find((s) => s.id === id) ?? null;
  return orNull(async () => (await live<{ shipment: ShipmentDetail }>(session, `/api/v1/warehouse/shipments/${encodeURIComponent(id)}`)).shipment);
}

export async function getReconciliation(session: Session, status: "discrepancies" | "all"): Promise<ReconciliationRow[]> {
  if (session.mode === "demo") return demoReconciliation.filter((r) => status === "all" || r.discrepancyStatus !== null);
  return (await live<{ items: ReconciliationRow[] }>(session, `/api/v1/warehouse/reconciliation?status=${status}`)).items;
}

export async function getAnalytics(session: Session): Promise<CommodityAnalytics[]> {
  if (session.mode === "demo") return demoAnalytics;
  return (await live<{ items: CommodityAnalytics[] }>(session, "/api/v1/warehouse/analytics")).items;
}
