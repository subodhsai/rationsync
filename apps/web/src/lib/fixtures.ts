import type {
  Commodity,
  InventoryItem,
  Me,
  ReviewHistoryItem,
  ShopApplication,
  ShopDetail,
  ShopRegistrationSummary,
  StockAlert,
  StockMovement,
  WarehouseOption,
} from "@rationsync/shared";

// FICTIONAL PREVIEW DATA, mirroring supabase/seed.sql. Shown only while Supabase is not
// configured, and always under a "Demo data" banner. Preview actions validate input but save nothing.

export const DEMO_PERSONAS = ["beneficiary", "beneficiary-new", "shop", "shop-new", "shop-pending", "shop-rejected", "warehouse"] as const;
export type DemoPersona = (typeof DEMO_PERSONAS)[number];

export const demoPersonaLabels: Record<DemoPersona, { title: string; detail: string }> = {
  beneficiary: { title: "Beneficiary", detail: "Household linked to Demo FPS Kuvempunagar" },
  "beneficiary-new": { title: "Beneficiary, new", detail: "Has not linked a demo card yet" },
  shop: { title: "Shop administrator", detail: "Approved shop DEMO-FPS-MYS-0101" },
  "shop-new": { title: "Shop administrator, new", detail: "Has not applied yet" },
  "shop-pending": { title: "Shop administrator, awaiting approval", detail: "Application under review" },
  "shop-rejected": { title: "Shop administrator, rejected", detail: "Application needs corrections" },
  warehouse: { title: "Warehouse administrator", detail: "Demo Wholesale Point, Mysuru" },
};

export const demoWarehouses: WarehouseOption[] = [
  { id: "0d9a0000-0000-4000-a000-000000000002", code: "DEMO-WH-DWD", name: "Demo Wholesale Point, Hubballi", district: "Dharwad" },
  { id: "0d9a0000-0000-4000-a000-000000000001", code: "DEMO-WH-MYS", name: "Demo Wholesale Point, Mysuru", district: "Mysuru" },
];
const MYS = demoWarehouses[1]!;

export const demoCommodities: Commodity[] = [
  { code: "RICE", nameEn: "Rice", nameKn: "ಅಕ್ಕಿ", unit: "kg" },
  { code: "WHEAT", nameEn: "Wheat", nameKn: "ಗೋಧಿ", unit: "kg" },
  { code: "RAGI", nameEn: "Ragi", nameKn: "ರಾಗಿ", unit: "kg" },
  { code: "JOWAR", nameEn: "Jowar", nameKn: "ಜೋಳ", unit: "kg" },
  { code: "SUGAR", nameEn: "Sugar", nameKn: "ಸಕ್ಕರೆ", unit: "kg" },
];

const approvedShop = {
  id: "0d9a0000-0000-4000-b000-000000000101",
  fpsId: "DEMO-FPS-MYS-0101",
  name: "Demo FPS Kuvempunagar",
  status: "approved" as const,
  reviewReason: null,
};

const shopAdmin = (id: string, fullName: string, shop: Me["shop"]): Me => ({
  id,
  role: "shop_admin",
  fullName,
  preferredLanguage: "en",
  shop,
  warehouseIds: [],
});

export const demoMe: Record<DemoPersona, Me> = {
  beneficiary: {
    id: "demo-beneficiary",
    role: "beneficiary",
    fullName: "Demo household 101",
    preferredLanguage: "en",
    shop: null,
    warehouseIds: [],
  },
  "beneficiary-new": {
    id: "demo-beneficiary-new",
    role: "beneficiary",
    fullName: "Demo new household",
    preferredLanguage: "en",
    shop: null,
    warehouseIds: [],
  },
  shop: shopAdmin("demo-shop-admin", "Demo shop administrator", approvedShop),
  "shop-new": shopAdmin("demo-shop-admin-new", "Demo new applicant", null),
  "shop-pending": shopAdmin("demo-shop-admin-pending", "Demo applicant", {
    id: "0d9a0000-0000-4000-b000-000000000117",
    fpsId: "DEMO-FPS-MYS-0117",
    name: "Demo FPS Saraswathipuram",
    status: "pending",
    reviewReason: null,
  }),
  "shop-rejected": shopAdmin("demo-shop-admin-rejected", "Demo rejected applicant", {
    id: "0d9a0000-0000-4000-b000-000000000109",
    fpsId: "DEMO-FPS-MYS-0109",
    name: "Demo FPS Bogadi",
    status: "rejected",
    reviewReason: "The FPS ID does not match the licence document. Check the number and resubmit.",
  }),
  warehouse: {
    id: "demo-warehouse-admin",
    role: "warehouse_admin",
    fullName: "Demo warehouse administrator",
    preferredLanguage: "en",
    shop: null,
    warehouseIds: [MYS.id],
  },
};

const updated = "2026-11-08T10:15:00+05:30";

const item = (code: string, quantity: number, lowStockThreshold: number, targetStock: number | null = null): InventoryItem => {
  const c = demoCommodities.find((x) => x.code === code)!;
  return { commodityCode: code, nameEn: c.nameEn, nameKn: c.nameKn, unit: c.unit, quantity, lowStockThreshold, targetStock, updatedAt: updated };
};

export const demoInventory: InventoryItem[] = [item("RICE", 1840, 800), item("WHEAT", 120, 150, 400), item("RAGI", 410, 200), item("SUGAR", 35, 50)];

const inventoryByShop: Record<string, InventoryItem[]> = {
  [approvedShop.id]: demoInventory,
  "0d9a0000-0000-4000-b000-000000000102": [item("RICE", 960, 800), item("WHEAT", 0, 150), item("RAGI", 520, 200), item("SUGAR", 90, 50)],
};

const movement = (
  id: string,
  code: string,
  kind: StockMovement["kind"],
  quantityDelta: number,
  balanceAfter: number,
  reason: string,
  createdAt: string,
  actorName: string | null = "Demo shop administrator",
): StockMovement => {
  const c = demoCommodities.find((x) => x.code === code)!;
  return { id, commodityCode: code, commodityName: c.nameEn, unit: c.unit, kind, quantityDelta, balanceAfter, reason, reference: null, actorName, createdAt };
};

export const demoMovements: StockMovement[] = [
  movement("m9", "SUGAR", "distribution", -25, 35, "Distributed to AAY card holders", "2026-11-08T10:15:00+05:30"),
  movement("m8", "RICE", "distribution", -240, 1840, "Distributed to card holders, evening session", "2026-11-07T18:40:00+05:30"),
  movement("m7", "RICE", "distribution", -320, 2080, "Distributed to card holders, morning session", "2026-11-07T11:05:00+05:30"),
  movement("m6", "RAGI", "adjustment", -10, 410, "Two bags damaged by roof leak", "2026-11-05T16:20:00+05:30"),
  movement("m5", "SUGAR", "opening_balance", 60, 60, "Demo opening balance", "2026-11-01T09:00:00+05:30", null),
  movement("m4", "RAGI", "opening_balance", 420, 420, "Demo opening balance", "2026-11-01T09:00:00+05:30", null),
  movement("m3", "WHEAT", "opening_balance", 120, 120, "Demo opening balance", "2026-11-01T09:00:00+05:30", null),
  movement("m2", "RICE", "opening_balance", 2400, 2400, "Demo opening balance", "2026-11-01T09:00:00+05:30", null),
];

const alert = (
  id: string,
  shop: { id: string; name: string; fpsId: string },
  code: string,
  current: InventoryItem,
  openedAt: string,
  resolvedAt: string | null = null,
): StockAlert => ({
  id,
  shopId: shop.id,
  shopName: shop.name,
  fpsId: shop.fpsId,
  commodityCode: code,
  commodityName: current.nameEn,
  unit: current.unit,
  status: resolvedAt ? "resolved" : "open",
  quantityAtOpen: current.quantity,
  thresholdAtOpen: current.lowStockThreshold,
  currentQuantity: current.quantity,
  currentThreshold: current.lowStockThreshold,
  openedAt,
  resolvedAt,
});

const vijayanagar = { id: "0d9a0000-0000-4000-b000-000000000102", name: "Demo FPS Vijayanagar", fpsId: "DEMO-FPS-MYS-0102" };

export const demoAlerts: StockAlert[] = [
  alert("a1", vijayanagar, "WHEAT", inventoryByShop[vijayanagar.id]![1]!, "2026-11-06T13:10:00+05:30"),
  alert("a2", approvedShop, "SUGAR", demoInventory[3]!, "2026-11-08T10:15:00+05:30"),
  alert("a3", approvedShop, "WHEAT", demoInventory[1]!, "2026-11-01T09:00:00+05:30"),
  {
    ...alert("a4", approvedShop, "RAGI", item("RAGI", 180, 200), "2026-10-24T17:30:00+05:30", "2026-10-29T11:00:00+05:30"),
    currentQuantity: 410,
  },
];

const registration = (
  id: string,
  fpsId: string,
  name: string,
  taluk: string,
  status: ShopRegistrationSummary["status"],
  submittedAt: string,
): ShopRegistrationSummary => ({
  id,
  fpsId,
  name,
  district: "Mysuru",
  taluk,
  warehouseId: MYS.id,
  warehouseName: MYS.name,
  status,
  submittedAt,
  openAlerts: demoAlerts.filter((a) => a.shopId === id && a.status === "open").length,
});

export const demoRegistrations: ShopRegistrationSummary[] = [
  registration("0d9a0000-0000-4000-b000-000000000117", "DEMO-FPS-MYS-0117", "Demo FPS Saraswathipuram", "Mysuru", "pending", "2026-11-07T11:42:00+05:30"),
  registration("0d9a0000-0000-4000-b000-000000000121", "DEMO-FPS-MYS-0121", "Demo FPS Hootagalli", "Mysuru", "pending", "2026-11-09T16:05:00+05:30"),
  registration(approvedShop.id, approvedShop.fpsId, approvedShop.name, "Mysuru", "approved", "2026-10-02T09:30:00+05:30"),
  registration(vijayanagar.id, vijayanagar.fpsId, vijayanagar.name, "Mysuru", "approved", "2026-10-03T14:10:00+05:30"),
  registration("0d9a0000-0000-4000-b000-000000000109", "DEMO-FPS-MYS-0109", "Demo FPS Bogadi", "Mysuru", "rejected", "2026-10-21T12:00:00+05:30"),
];

export const demoReviews: ReviewHistoryItem[] = [
  {
    id: "r3",
    decision: "rejected",
    reason: "The FPS ID does not match the licence document. Check the number and resubmit.",
    reviewerName: "Demo warehouse administrator",
    createdAt: "2026-10-22T15:20:00+05:30",
    shopId: "0d9a0000-0000-4000-b000-000000000109",
    shopName: "Demo FPS Bogadi",
    fpsId: "DEMO-FPS-MYS-0109",
  },
  {
    id: "r2",
    decision: "approved",
    reason: "Licence and address match the demo record",
    reviewerName: "Demo warehouse administrator",
    createdAt: "2026-10-04T10:05:00+05:30",
    shopId: vijayanagar.id,
    shopName: vijayanagar.name,
    fpsId: vijayanagar.fpsId,
  },
  {
    id: "r1",
    decision: "approved",
    reason: "Licence and address match the demo record",
    reviewerName: "Demo warehouse administrator",
    createdAt: "2026-10-03T12:40:00+05:30",
    shopId: approvedShop.id,
    shopName: approvedShop.name,
    fpsId: approvedShop.fpsId,
  },
];

const addresses: Record<string, [string, string]> = {
  [approvedShop.id]: ["2nd Cross, Kuvempunagar, Mysuru", "570023"],
  [vijayanagar.id]: ["4th Main, Vijayanagar 2nd Stage, Mysuru", "570017"],
  "0d9a0000-0000-4000-b000-000000000117": ["8th Cross, Saraswathipuram, Mysuru", "570009"],
  "0d9a0000-0000-4000-b000-000000000121": ["Main Road, Hootagalli, Mysuru", "570018"],
  "0d9a0000-0000-4000-b000-000000000109": ["Ring Road, Bogadi, Mysuru", "570026"],
};

export function demoApplication(shopId: string): ShopApplication | null {
  const summary = demoRegistrations.find((r) => r.id === shopId);
  if (!summary) return null;
  const review = demoReviews.find((r) => r.shopId === shopId);
  const [address, pinCode] = addresses[shopId]!;
  return {
    id: summary.id,
    fpsId: summary.fpsId,
    name: summary.name,
    district: summary.district,
    taluk: summary.taluk,
    address,
    pinCode,
    contactPhone: "+91 90000 00" + summary.fpsId.slice(-3),
    contactEmail: null,
    warehouse: MYS,
    status: summary.status,
    reviewReason: review?.reason ?? null,
    reviewedAt: review?.createdAt ?? null,
    submittedAt: summary.submittedAt,
    updatedAt: review?.createdAt ?? summary.submittedAt,
    documents:
      summary.status === "approved"
        ? []
        : [
            {
              id: `doc-${shopId}`,
              fileName: "FPS licence (demo).pdf",
              contentType: "application/pdf",
              sizeBytes: 182_400,
              storagePath: `demo/${shopId}/licence.pdf`,
              uploadedAt: summary.submittedAt,
            },
          ],
    reviews: review ? [review] : [],
  };
}

export function demoShopDetail(shopId: string): ShopDetail | null {
  const application = demoApplication(shopId);
  if (!application) return null;
  return {
    ...application,
    inventory: inventoryByShop[shopId] ?? [],
    alerts: demoAlerts.filter((a) => a.shopId === shopId),
  };
}
