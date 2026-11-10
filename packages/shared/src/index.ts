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
  warehouseName: string;
  status: ShopStatus;
  submittedAt: string;
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
