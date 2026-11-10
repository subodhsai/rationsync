import "server-only";
import type { BeneficiaryOverview, InventoryItem, ShopRegistrationSummary, ShopStatus } from "@rationsync/shared";
import { connection } from "next/server";
import { apiGet } from "@/lib/api";
import { demoBeneficiaryOverview, demoInventory, demoRegistrations } from "@/lib/fixtures";
import type { Session } from "@/lib/session";

// Each loader reads fixtures in preview mode and the Render API otherwise.

export async function getShopInventory(session: Session): Promise<InventoryItem[]> {
  if (session.mode === "demo") return demoInventory;
  return (await apiGet<{ items: InventoryItem[] }>("/api/v1/shop/inventory", session.accessToken)).items;
}

export async function getShopRegistrations(session: Session, status: ShopStatus): Promise<ShopRegistrationSummary[]> {
  if (session.mode === "demo") return demoRegistrations.filter((r) => r.status === status);
  const { items } = await apiGet<{ items: ShopRegistrationSummary[] }>(
    `/api/v1/warehouse/shop-registrations?status=${status}`,
    session.accessToken,
  );
  return items;
}

export async function getBeneficiaryOverview(session: Session): Promise<BeneficiaryOverview> {
  if (session.mode === "demo") {
    await connection(); // the sample booking is relative to the current time
    return demoBeneficiaryOverview(new Date());
  }
  return apiGet<BeneficiaryOverview>("/api/v1/beneficiary/overview", session.accessToken);
}
