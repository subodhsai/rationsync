import { z } from "zod";

export const APP_ROLES = ["beneficiary", "shop_admin", "warehouse_admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

// Roles a person may choose at sign-up. warehouse_admin is provisioned, never self-selected.
export const accountTypeSchema = z.enum(["beneficiary", "shop_admin"]);
export type AccountType = z.infer<typeof accountTypeSchema>;

export type ShopStatus = "pending" | "approved" | "rejected";
export type BookingStatus = "booked" | "cancelled" | "checked_in";
export type Language = "en" | "kn";
export type CardCategory = "AAY" | "PHH" | "NPHH";

export const ROLE_HOME: Record<AppRole, "/beneficiary" | "/shop" | "/warehouse"> = {
  beneficiary: "/beneficiary",
  shop_admin: "/shop",
  warehouse_admin: "/warehouse",
};

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters").max(72),
  accountType: accountTypeSchema,
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export type StockLevel = "out" | "low" | "ok";

// The same rule the database alerts use: low at or below the shop's own threshold.
export function stockLevel(quantity: number, lowStockThreshold: number): StockLevel {
  if (quantity <= 0) return "out";
  if (quantity <= lowStockThreshold) return "low";
  return "ok";
}

// API contracts shared by apps/api (producer) and apps/web (consumer).

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface Me {
  id: string;
  role: AppRole;
  fullName: string;
  preferredLanguage: Language;
  shop: {
    id: string;
    fpsId: string;
    name: string;
    status: ShopStatus;
    reviewReason: string | null;
  } | null;
  warehouseIds: string[];
}

export interface InventoryItem {
  commodityCode: string;
  nameEn: string;
  nameKn: string;
  unit: string;
  quantity: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface ShopRegistrationSummary {
  id: string;
  fpsId: string;
  name: string;
  district: string;
  taluk: string;
  warehouseId: string;
  warehouseName: string;
  status: ShopStatus;
  submittedAt: string;
  openAlerts: number;
}

export interface BeneficiaryOverview {
  card: { cardNumber: string; category: CardCategory; memberCount: number } | null;
  shop: {
    fpsId: string;
    name: string;
    address: string;
    openingHours: string;
    contactPhone: string;
  } | null;
  stock: Array<Pick<InventoryItem, "commodityCode" | "nameEn" | "nameKn" | "unit"> & { level: StockLevel }>;
  upcomingBooking: { id: string; startsAt: string; endsAt: string; status: BookingStatus } | null;
}

// Phase 2: applications, review, stock operations, alerts ----------------------

export const KARNATAKA_DISTRICTS = [
  "Bagalkot", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru South", "Bengaluru Urban", "Bidar",
  "Chamarajanagar", "Chikkaballapur", "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere",
  "Dharwad", "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal", "Mandya", "Mysuru",
  "Raichur", "Shivamogga", "Tumakuru", "Udupi", "Uttara Kannada", "Vijayanagara", "Vijayapura", "Yadgir",
] as const;

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

// Accepts "+91 98450 12345", "098450-12345" or a landline with STD code; stores one format.
const phoneSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, "").replace(/^\+91/, ""))
  .pipe(z.string().regex(/^([6-9]\d{9}|0\d{10})$/, "Enter a 10-digit mobile number, or a landline with its STD code"))
  .transform((d) => (d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : d));

export const shopRegistrationSchema = z.object({
  fpsId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,24}$/, "Use 4 to 24 letters, digits or hyphens, as printed on your FPS licence"),
  name: z.string().trim().min(3, "Enter the shop name").max(120),
  district: z.enum(KARNATAKA_DISTRICTS, { error: "Choose a district" }),
  taluk: z.string().trim().min(2, "Enter the taluk").max(60),
  address: z.string().trim().min(8, "Enter the full shop address").max(300),
  pinCode: z.string().trim().regex(/^5[6-9]\d{4}$/, "Karnataka PIN codes have 6 digits and start with 56 to 59"),
  contactPhone: phoneSchema,
  contactEmail: z
    .union([z.literal(""), z.email("Enter a valid email address, or leave it blank")])
    .optional()
    .transform((v) => v || null),
  warehouseId: z.uuid("Choose the warehouse that supplies this shop"),
});
export type ShopRegistrationInput = z.input<typeof shopRegistrationSchema>;

export const reviewDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(3, "Record a reason of at least 3 characters").max(500),
});

const quantitySchema = z.coerce
  .number({ error: "Enter a quantity" })
  .positive("Enter a quantity above zero")
  .max(1_000_000, "That quantity is too large")
  .refine(twoDecimals, "Use at most two decimal places");

const movementBase = {
  commodityCode: z.string().regex(/^[A-Z_]{2,24}$/, "Choose a commodity"),
  quantity: quantitySchema,
  reason: z.string().trim().min(3, "Say why, in a few words").max(500),
};

// Kinds a shop administrator may record. Receipts arrive only through warehouse shipments.
export const stockMovementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opening_balance"), ...movementBase }),
  z.object({ kind: z.literal("distribution"), ...movementBase }),
  z.object({ kind: z.literal("adjustment"), direction: z.enum(["increase", "decrease"]), ...movementBase }),
]);
export type StockMovementInput = z.infer<typeof stockMovementSchema>;

export function movementDelta(input: StockMovementInput): number {
  const decreases = input.kind === "distribution" || (input.kind === "adjustment" && input.direction === "decrease");
  return decreases ? -input.quantity : input.quantity;
}

export const thresholdSchema = z.object({
  lowStockThreshold: z.coerce
    .number({ error: "Enter a threshold" })
    .min(0, "The threshold cannot be negative")
    .max(1_000_000)
    .refine(twoDecimals, "Use at most two decimal places"),
});

export const idempotencyKeySchema = z.string().min(8).max(100);

export type MovementKind = "opening_balance" | "receipt" | "distribution" | "adjustment";
export type AlertStatus = "open" | "resolved";

export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  district: string;
}

export interface Commodity {
  code: string;
  nameEn: string;
  nameKn: string;
  unit: string;
}

export interface ShopDocument {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedAt: string;
}

export interface ShopReview {
  id: string;
  decision: "approved" | "rejected";
  reason: string;
  reviewerName: string;
  createdAt: string;
}

export interface ShopApplication {
  id: string;
  fpsId: string;
  name: string;
  district: string;
  taluk: string;
  address: string;
  pinCode: string | null;
  contactPhone: string;
  contactEmail: string | null;
  warehouse: WarehouseOption;
  status: ShopStatus;
  reviewReason: string | null;
  reviewedAt: string | null;
  submittedAt: string;
  updatedAt: string;
  documents: ShopDocument[];
  reviews: ShopReview[];
}

export interface StockMovement {
  id: string;
  commodityCode: string;
  commodityName: string;
  unit: string;
  kind: MovementKind;
  quantityDelta: number;
  balanceAfter: number;
  reason: string;
  reference: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface StockAlert {
  id: string;
  shopId: string;
  shopName: string;
  fpsId: string;
  commodityCode: string;
  commodityName: string;
  unit: string;
  status: AlertStatus;
  quantityAtOpen: number;
  thresholdAtOpen: number;
  currentQuantity: number;
  currentThreshold: number;
  openedAt: string;
  resolvedAt: string | null;
}

export interface ShopDetail extends ShopApplication {
  inventory: InventoryItem[];
  alerts: StockAlert[];
}

export interface ReviewHistoryItem extends ShopReview {
  shopId: string;
  shopName: string;
  fpsId: string;
}
