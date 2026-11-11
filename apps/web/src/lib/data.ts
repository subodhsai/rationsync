import "server-only";
import type {
  AlertStatus,
  BeneficiaryOverview,
  Commodity,
  InventoryItem,
  KARNATAKA_DISTRICTS,
  ReviewHistoryItem,
  ShopApplication,
  ShopDetail,
  ShopRegistrationSummary,
  ShopStatus,
  StockAlert,
  StockMovement,
  WarehouseOption,
} from "@rationsync/shared";
import { connection } from "next/server";
import { ApiError, apiGet } from "@/lib/api";
import {
  demoAlerts,
  demoApplication,
  demoCommodities,
  demoInventory,
  demoMovements,
  demoRegistrations,
  demoReviews,
  demoShopDetail,
  demoWarehouses,
} from "@/lib/fixtures";
import type { Session } from "@/lib/session";
import { demoBeneficiaryOverview } from "@/lib/visit-fixtures";

// Each loader reads fixtures in preview mode and the Render API otherwise. The contracts are
// the shared types, so both paths render identically.

type Live = Extract<Session, { mode: "live" }>;
const live = <T>(session: Live, path: string) => apiGet<T>(path, session.accessToken);
const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
};

// Shop administrator ----------------------------------------------------------

export async function getApplication(session: Session): Promise<ShopApplication | null> {
  if (session.mode === "demo") return session.me.shop ? demoApplication(session.me.shop.id) : null;
  return (await live<{ application: ShopApplication | null }>(session, "/api/v1/registration")).application;
}

export async function getRegistrationWarehouses(session: Session): Promise<WarehouseOption[]> {
  if (session.mode === "demo") return demoWarehouses;
  return (await live<{ items: WarehouseOption[] }>(session, "/api/v1/registration/warehouses")).items;
}

export async function getShopInventory(session: Session): Promise<InventoryItem[]> {
  if (session.mode === "demo") return demoInventory;
  return (await live<{ items: InventoryItem[] }>(session, "/api/v1/shop/inventory")).items;
}

export async function getCommodities(session: Session): Promise<Commodity[]> {
  if (session.mode === "demo") return demoCommodities;
  const area = session.me.role === "warehouse_admin" ? "warehouse" : "shop";
  return (await live<{ items: Commodity[] }>(session, `/api/v1/${area}/commodities`)).items;
}

export async function getMovements(
  session: Session,
  { commodity, before, limit }: { commodity?: string; before?: string; limit?: number } = {},
): Promise<{ items: StockMovement[]; nextCursor: string | null }> {
  if (session.mode === "demo") {
    const items = demoMovements.filter((m) => !commodity || m.commodityCode === commodity);
    return { items: items.slice(0, limit ?? 50), nextCursor: null };
  }
  return live(session, `/api/v1/shop/movements${qs({ commodity, before, limit: limit?.toString() })}`);
}

export async function getShopAlerts(session: Session, status: AlertStatus | "all"): Promise<StockAlert[]> {
  if (session.mode === "demo") {
    const shopId = session.me.shop?.id;
    return demoAlerts.filter((a) => a.shopId === shopId && (status === "all" || a.status === status));
  }
  return (await live<{ items: StockAlert[] }>(session, `/api/v1/shop/alerts?status=${status}`)).items;
}

// Warehouse administrator -----------------------------------------------------

export type RegistrationFilters = {
  status: ShopStatus;
  district?: (typeof KARNATAKA_DISTRICTS)[number];
  warehouseId?: string;
};

export async function getShopRegistrations(
  session: Session,
  filters: RegistrationFilters,
): Promise<ShopRegistrationSummary[]> {
  if (session.mode === "demo") {
    return demoRegistrations.filter(
      (r) =>
        r.status === filters.status &&
        (!filters.district || r.district === filters.district) &&
        (!filters.warehouseId || r.warehouseId === filters.warehouseId),
    );
  }
  return (
    await live<{ items: ShopRegistrationSummary[] }>(session, `/api/v1/warehouse/shop-registrations${qs(filters)}`)
  ).items;
}

export async function getMyWarehouses(session: Session): Promise<WarehouseOption[]> {
  if (session.mode === "demo") return demoWarehouses.filter((w) => session.me.warehouseIds.includes(w.id));
  return (await live<{ items: WarehouseOption[] }>(session, "/api/v1/warehouse/warehouses")).items;
}

/** Null when the shop does not exist or is outside the administrator's warehouses. */
export async function getShopDetail(session: Session, shopId: string): Promise<ShopDetail | null> {
  if (session.mode === "demo") return demoShopDetail(shopId);
  try {
    return (await live<{ shop: ShopDetail }>(session, `/api/v1/warehouse/shops/${encodeURIComponent(shopId)}`)).shop;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getWarehouseAlerts(session: Session, status: AlertStatus | "all"): Promise<StockAlert[]> {
  if (session.mode === "demo") return demoAlerts.filter((a) => status === "all" || a.status === status);
  return (await live<{ items: StockAlert[] }>(session, `/api/v1/warehouse/alerts?status=${status}`)).items;
}

export async function getReviewHistory(session: Session): Promise<ReviewHistoryItem[]> {
  if (session.mode === "demo") return demoReviews;
  return (await live<{ items: ReviewHistoryItem[] }>(session, "/api/v1/warehouse/reviews")).items;
}

// Beneficiary -----------------------------------------------------------------

export async function getBeneficiaryOverview(session: Session): Promise<BeneficiaryOverview> {
  if (session.mode === "demo") {
    await connection(); // the sample booking is relative to the current time
    if (session.persona === "beneficiary-new") return { card: null, shop: null, stock: [], upcomingBooking: null, unreadNotifications: 0 };
    return demoBeneficiaryOverview(new Date());
  }
  return apiGet<BeneficiaryOverview>("/api/v1/beneficiary/overview", session.accessToken);
}
