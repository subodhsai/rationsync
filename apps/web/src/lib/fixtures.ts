import type { BeneficiaryOverview, InventoryItem, Me, ShopRegistrationSummary, ShopStatus } from "@rationsync/shared";
import { stockLevel } from "@rationsync/shared";

// FICTIONAL PREVIEW DATA, mirroring supabase/seed.sql. Shown only while Supabase is not
// configured, and always under a "Demo data" banner.

export const DEMO_PERSONAS = ["beneficiary", "shop", "shop-pending", "warehouse"] as const;
export type DemoPersona = (typeof DEMO_PERSONAS)[number];

export const demoPersonaLabels: Record<DemoPersona, { title: string; detail: string }> = {
  beneficiary: { title: "Beneficiary", detail: "Household linked to Demo FPS Kuvempunagar" },
  shop: { title: "Shop administrator", detail: "Approved shop DEMO-FPS-MYS-0101" },
  "shop-pending": { title: "Shop administrator, awaiting approval", detail: "Registration under review" },
  warehouse: { title: "Warehouse administrator", detail: "Demo Wholesale Point, Mysuru" },
};

const approvedShop = {
  id: "0d9a0000-0000-4000-b000-000000000101",
  fpsId: "DEMO-FPS-MYS-0101",
  name: "Demo FPS Kuvempunagar",
  status: "approved" as const,
  reviewReason: null,
};

export const demoMe: Record<DemoPersona, Me> = {
  beneficiary: {
    id: "demo-beneficiary",
    role: "beneficiary",
    fullName: "Demo household 101",
    preferredLanguage: "en",
    shop: null,
    warehouseIds: [],
  },
  shop: {
    id: "demo-shop-admin",
    role: "shop_admin",
    fullName: "Demo shop administrator",
    preferredLanguage: "en",
    shop: approvedShop,
    warehouseIds: [],
  },
  "shop-pending": {
    id: "demo-shop-admin-pending",
    role: "shop_admin",
    fullName: "Demo applicant",
    preferredLanguage: "en",
    shop: {
      id: "demo-pending-shop",
      fpsId: "DEMO-FPS-MYS-0117",
      name: "Demo FPS Saraswathipuram",
      status: "pending",
      reviewReason: null,
    },
    warehouseIds: [],
  },
  warehouse: {
    id: "demo-warehouse-admin",
    role: "warehouse_admin",
    fullName: "Demo warehouse administrator",
    preferredLanguage: "en",
    shop: null,
    warehouseIds: ["0d9a0000-0000-4000-a000-000000000001"],
  },
};

const updated = "2026-11-08T10:15:00+05:30";

export const demoInventory: InventoryItem[] = [
  { commodityCode: "RICE", nameEn: "Rice", nameKn: "ಅಕ್ಕಿ", unit: "kg", quantity: 1840, lowStockThreshold: 800, updatedAt: updated },
  { commodityCode: "WHEAT", nameEn: "Wheat", nameKn: "ಗೋಧಿ", unit: "kg", quantity: 120, lowStockThreshold: 150, updatedAt: updated },
  { commodityCode: "RAGI", nameEn: "Ragi", nameKn: "ರಾಗಿ", unit: "kg", quantity: 410, lowStockThreshold: 200, updatedAt: updated },
  { commodityCode: "SUGAR", nameEn: "Sugar", nameKn: "ಸಕ್ಕರೆ", unit: "kg", quantity: 35, lowStockThreshold: 50, updatedAt: updated },
];

const registration = (
  id: string,
  fpsId: string,
  name: string,
  taluk: string,
  status: ShopStatus,
  submittedAt: string,
): ShopRegistrationSummary => ({
  id,
  fpsId,
  name,
  district: "Mysuru",
  taluk,
  warehouseName: "Demo Wholesale Point, Mysuru",
  status,
  submittedAt,
});

export const demoRegistrations: ShopRegistrationSummary[] = [
  registration("demo-r1", "DEMO-FPS-MYS-0117", "Demo FPS Saraswathipuram", "Mysuru", "pending", "2026-11-07T11:42:00+05:30"),
  registration("demo-r2", "DEMO-FPS-MYS-0121", "Demo FPS Hootagalli", "Mysuru", "pending", "2026-11-09T16:05:00+05:30"),
  registration("demo-r3", "DEMO-FPS-MYS-0101", "Demo FPS Kuvempunagar", "Mysuru", "approved", "2026-10-02T09:30:00+05:30"),
  registration("demo-r4", "DEMO-FPS-MYS-0102", "Demo FPS Vijayanagar", "Mysuru", "approved", "2026-10-03T14:10:00+05:30"),
  registration("demo-r5", "DEMO-FPS-MYS-0109", "Demo FPS Bogadi", "Mysuru", "rejected", "2026-10-21T12:00:00+05:30"),
];

/** Built per request so the sample appointment stays in the future. */
export function demoBeneficiaryOverview(now: Date): BeneficiaryOverview {
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day = tomorrow.toISOString().slice(0, 10);
  return {
    card: { cardNumber: "•••••••••01", category: "PHH", memberCount: 4 },
    shop: {
      fpsId: approvedShop.fpsId,
      name: approvedShop.name,
      address: "2nd Cross, Kuvempunagar, Mysuru",
      openingHours: "Mon to Sat, 8:00 to 12:00 and 16:00 to 20:00",
      contactPhone: "+91 90000 00101",
    },
    stock: demoInventory.map(({ commodityCode, nameEn, nameKn, unit, quantity, lowStockThreshold }) => ({
      commodityCode,
      nameEn,
      nameKn,
      unit,
      level: stockLevel(quantity, lowStockThreshold),
    })),
    upcomingBooking: {
      id: "demo-booking",
      startsAt: `${day}T09:00:00+05:30`,
      endsAt: `${day}T11:00:00+05:30`,
      status: "booked",
    },
  };
}
