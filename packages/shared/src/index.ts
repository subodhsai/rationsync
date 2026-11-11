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
  /** Fill-up level for replenishment suggestions; null means twice the threshold. */
  targetStock: number | null;
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

// Phase 3: warehouse stock, replenishment, shipments, reconciliation ------------

export const REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];
export const REQUEST_STATUSES = ["pending", "approved", "rejected", "partially_fulfilled", "fulfilled", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const SHIPMENT_STATUSES = [
  "preparing", "dispatched", "in_transit", "delivered", "partially_received", "disputed", "cancelled",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export type WarehouseMovementKind = "opening_balance" | "receipt" | "adjustment" | "dispatch";

/** Allowed status changes. The database trigger enforces the same table. */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  preparing: ["dispatched", "cancelled"],
  dispatched: ["in_transit", "delivered", "partially_received", "disputed"],
  in_transit: ["delivered", "partially_received", "disputed"],
  disputed: ["delivered", "partially_received"],
  delivered: [],
  partially_received: [],
  cancelled: [],
};
export const AWAITING_RECEIPT: ShipmentStatus[] = ["dispatched", "in_transit", "disputed"];
export const ACTIVE_SHIPMENT: ShipmentStatus[] = ["preparing", ...AWAITING_RECEIPT];

const reasonSchema = z.string().trim().min(3, "Say why, in a few words").max(500);

export const replenishmentRequestSchema = z.object({
  commodityCode: movementBase.commodityCode,
  quantity: quantitySchema,
  reason: reasonSchema,
  priority: z.enum(REQUEST_PRIORITIES, { error: "Choose a priority" }),
  suggestedQuantity: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).optional()),
});
export type ReplenishmentRequestInput = z.infer<typeof replenishmentRequestSchema>;

export const requestDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approved"), approvedQuantity: quantitySchema, reason: reviewDecisionSchema.shape.reason }),
  z.object({ decision: z.literal("rejected"), reason: reviewDecisionSchema.shape.reason }),
]);

export const createShipmentSchema = z.object({
  shopId: z.uuid(),
  requestIds: z.array(z.uuid()).min(1, "Choose at least one approved request").max(20),
  expectedDeliveryDate: z.iso.date("Enter the expected delivery date"),
  notes: z.string().trim().max(500).optional(),
});

export const dispatchShipmentSchema = z.object({
  expectedDeliveryDate: z.iso.date("Enter a valid date").optional(),
});

const receiptQuantity = z.coerce
  .number({ error: "Enter a quantity, or 0" })
  .min(0, "Cannot be negative")
  .max(1_000_000)
  .refine(twoDecimals, "Use at most two decimal places");

export const receiveShipmentSchema = z.object({
  items: z
    .array(z.object({ itemId: z.uuid(), receivedQuantity: receiptQuantity, damagedQuantity: receiptQuantity }))
    .min(1),
  note: z.string().trim().max(500).optional(),
});

export const reasonOnlySchema = z.object({ reason: reasonSchema });
export const resolveDiscrepancySchema = z.object({ resolution: reasonSchema });

export const warehouseMovementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opening_balance"), ...movementBase }),
  z.object({ kind: z.literal("receipt"), reference: z.string().trim().max(100).optional(), ...movementBase }),
  z.object({ kind: z.literal("adjustment"), direction: z.enum(["increase", "decrease"]), ...movementBase }),
]);
export type WarehouseMovementInput = z.infer<typeof warehouseMovementSchema>;

export const warehouseMovementDelta = (input: WarehouseMovementInput) =>
  input.kind === "adjustment" && input.direction === "decrease" ? -input.quantity : input.quantity;

/** Threshold plus an optional target; the target must sit above the threshold. */
export const stockLevelsSchema = thresholdSchema
  .extend({
    targetStock: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().positive().max(1_000_000).refine(twoDecimals, "Use at most two decimal places").optional(),
    ),
  })
  .refine((v) => v.targetStock === undefined || v.targetStock > v.lowStockThreshold, {
    path: ["targetStock"],
    message: "The target must be above the low-stock threshold",
  });

// Automation rules -------------------------------------------------------------
// Plain arithmetic on recorded movements, kept here so the API and preview mode agree and
// every number can be explained on screen. Nothing here is a prediction model.

export const FORECAST_WINDOW_DAYS = 30;
export const MIN_HISTORY_DAYS = 7;
export const MIN_DISTRIBUTIONS = 3;
export const URGENT_COVER_DAYS = 3;
export const HIGH_COVER_DAYS = 7;

/** Distributions recorded in the last FORECAST_WINDOW_DAYS, over `days` of available history. */
export interface UsageHistory {
  distributed: number;
  entries: number;
  days: number;
}

export type Forecast =
  | { status: "estimate"; dailyUsage: number; daysOfCover: number; basis: string }
  | { status: "insufficient"; basis: string };

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function forecastCoverage(onHand: number, usage: UsageHistory, unit: string): Forecast {
  if (usage.days < MIN_HISTORY_DAYS || usage.entries < MIN_DISTRIBUTIONS || usage.distributed <= 0) {
    return {
      status: "insufficient",
      basis: `Needs at least ${MIN_DISTRIBUTIONS} distributions over ${MIN_HISTORY_DAYS} days; has ${usage.entries} over ${usage.days} ${usage.days === 1 ? "day" : "days"}.`,
    };
  }
  const daily = usage.distributed / usage.days;
  return {
    status: "estimate",
    dailyUsage: Math.round(daily * 100) / 100,
    daysOfCover: Math.floor(onHand / daily),
    basis: `${fmt(usage.distributed)} ${unit} distributed in ${usage.entries} entries over the last ${usage.days} days, about ${fmt(daily)} ${unit} a day.`,
  };
}

export interface PriorityRecommendation {
  priority: RequestPriority;
  reason: string;
}

export function recommendPriority(onHand: number, threshold: number, forecast: Forecast, unit: string): PriorityRecommendation {
  const cover = forecast.status === "estimate" ? forecast.daysOfCover : null;
  if (onHand <= 0) return { priority: "urgent", reason: "Out of stock." };
  if (cover !== null && cover < URGENT_COVER_DAYS) {
    return { priority: "urgent", reason: `About ${cover} ${cover === 1 ? "day" : "days"} of stock left at recent usage (under ${URGENT_COVER_DAYS}).` };
  }
  if (onHand <= threshold / 2) {
    return { priority: "high", reason: `${fmt(onHand)} ${unit} is at or below half the ${fmt(threshold)} ${unit} threshold.` };
  }
  if (cover !== null && cover < HIGH_COVER_DAYS) {
    return { priority: "high", reason: `About ${cover} days of stock left at recent usage (under ${HIGH_COVER_DAYS}).` };
  }
  if (onHand <= threshold) {
    return { priority: "normal", reason: `${fmt(onHand)} ${unit} is at or below the ${fmt(threshold)} ${unit} threshold.` };
  }
  return { priority: "low", reason: `${fmt(onHand)} ${unit} is above the ${fmt(threshold)} ${unit} threshold.` };
}

export const priorityRank: Record<RequestPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * How much to request: fill up to the target, less anything already approved and on its way.
 * Offered only at or below the threshold, and never while a request for it is still open.
 */
export function suggestQuantity(input: {
  onHand: number;
  threshold: number;
  target: number | null;
  incoming: number;
  hasOpenRequest: boolean;
}): { quantity: number; target: number; targetIsDefault: boolean } {
  const target = input.target ?? input.threshold * 2;
  const needed = input.onHand <= input.threshold && !input.hasOpenRequest;
  return {
    quantity: needed ? Math.max(0, Math.ceil(target - input.onHand - input.incoming)) : 0,
    target,
    targetIsDefault: input.target === null,
  };
}

export interface OpenRequestRef {
  id: string;
  reference: string;
  status: RequestStatus;
  quantity: number;
}

export interface ReplenishmentSuggestion {
  commodityCode: string;
  nameEn: string;
  nameKn: string;
  unit: string;
  onHand: number;
  threshold: number;
  target: number;
  targetIsDefault: boolean;
  incoming: number;
  openRequest: OpenRequestRef | null;
  suggestedQuantity: number;
  forecast: Forecast;
  recommendation: PriorityRecommendation;
}

/** One commodity's suggestion from its stock row, open request and usage. */
export function buildSuggestion(
  item: Pick<InventoryItem, "commodityCode" | "nameEn" | "nameKn" | "unit" | "quantity" | "lowStockThreshold"> & {
    targetStock: number | null;
  },
  openRequest: OpenRequestRef | null,
  usage: UsageHistory,
): ReplenishmentSuggestion {
  const incoming = openRequest?.status === "approved" ? openRequest.quantity : 0;
  const s = suggestQuantity({
    onHand: item.quantity,
    threshold: item.lowStockThreshold,
    target: item.targetStock,
    incoming,
    hasOpenRequest: openRequest !== null,
  });
  const forecast = forecastCoverage(item.quantity, usage, item.unit);
  return {
    commodityCode: item.commodityCode,
    nameEn: item.nameEn,
    nameKn: item.nameKn,
    unit: item.unit,
    onHand: item.quantity,
    threshold: item.lowStockThreshold,
    target: s.target,
    targetIsDefault: s.targetIsDefault,
    incoming,
    openRequest,
    suggestedQuantity: s.quantity,
    forecast,
    recommendation: recommendPriority(item.quantity, item.lowStockThreshold, forecast, item.unit),
  };
}

// Phase 3 API contracts ----------------------------------------------------------

export interface ReplenishmentRequest {
  id: string;
  reference: string;
  shopId: string;
  shopName: string;
  fpsId: string;
  district: string;
  warehouseId: string;
  warehouseName: string;
  commodityCode: string;
  commodityName: string;
  unit: string;
  requestedQuantity: number;
  approvedQuantity: number | null;
  receivedQuantity: number | null;
  stockAtRequest: number;
  suggestedQuantity: number | null;
  reason: string;
  priority: RequestPriority;
  status: RequestStatus;
  decisionReason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  requestedByName: string | null;
  createdAt: string;
  closedAt: string | null;
  shipment: { id: string; reference: string; status: ShipmentStatus } | null;
  /** From the shop's current stock and usage; included on warehouse views. */
  recommendation?: PriorityRecommendation;
}

export interface RequestDetail extends ReplenishmentRequest {
  shopStock: { onHand: number; threshold: number; target: number | null } | null;
  warehouseStock: { onHand: number; reserved: number; available: number } | null;
  forecast: Forecast;
  recommendation: PriorityRecommendation;
}

export interface WarehouseStockItem {
  warehouseId: string;
  warehouseName: string;
  commodityCode: string;
  nameEn: string;
  nameKn: string;
  unit: string;
  onHand: number;
  reserved: number;
  available: number;
  inTransit: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface WarehouseMovement {
  id: string;
  warehouseId: string;
  commodityCode: string;
  commodityName: string;
  unit: string;
  kind: WarehouseMovementKind;
  quantityDelta: number;
  balanceAfter: number;
  reason: string;
  reference: string | null;
  shipmentId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface ShipmentSummary {
  id: string;
  reference: string;
  status: ShipmentStatus;
  warehouseId: string;
  warehouseName: string;
  shopId: string;
  shopName: string;
  fpsId: string;
  expectedDeliveryDate: string;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  items: Array<{ commodityName: string; quantity: number; unit: string }>;
  openDiscrepancies: number;
}

export interface ShipmentItem {
  id: string;
  requestId: string;
  requestReference: string;
  commodityCode: string;
  commodityName: string;
  unit: string;
  requestedQuantity: number;
  approvedQuantity: number;
  quantity: number;
  receivedQuantity: number | null;
  damagedQuantity: number | null;
  discrepancy: {
    id: string;
    shortageQuantity: number;
    damagedQuantity: number;
    status: "open" | "resolved";
    resolution: string | null;
    resolvedByName: string | null;
    resolvedAt: string | null;
  } | null;
}

export interface ShipmentDetail extends ShipmentSummary {
  notes: string | null;
  createdByName: string | null;
  dispatchedByName: string | null;
  inTransitAt: string | null;
  receivedByName: string | null;
  receiptNote: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  detailItems: ShipmentItem[];
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface WarehouseOverview {
  pendingRequests: number;
  urgentRequests: number;
  activeShipments: number;
  awaitingReceipt: number;
  overdueShipments: number;
  lowStockShops: number;
  openDiscrepancies: number;
  lowWarehouseStock: number;
}

export interface ReconciliationRow {
  requestId: string;
  requestReference: string;
  shipmentId: string | null;
  shipmentReference: string | null;
  shipmentStatus: ShipmentStatus | null;
  shopName: string;
  fpsId: string;
  commodityName: string;
  unit: string;
  requested: number;
  approved: number;
  dispatched: number | null;
  received: number | null;
  damaged: number | null;
  shortage: number | null;
  discrepancyStatus: "open" | "resolved" | null;
}

export interface CommodityAnalytics {
  commodityCode: string;
  nameEn: string;
  unit: string;
  warehouseOnHand: number;
  warehouseReserved: number;
  warehouseAvailable: number;
  inTransit: number;
  shopStock: number;
  shopsStocking: number;
  shopsLow: number;
  usage: UsageHistory;
  forecast: Forecast;
}

export interface Page<T> {
  items: T[];
  page: number;
  total: number;
  pageSize: number;
}

export interface WarehouseOverviewResponse {
  metrics: WarehouseOverview;
  requests: ReplenishmentRequest[];
  shipments: ShipmentSummary[];
}
