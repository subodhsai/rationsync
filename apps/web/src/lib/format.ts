import type { AppRole, MovementKind, WarehouseMovementKind } from "@rationsync/shared";

const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const weekdayDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

export const formatQuantity = (value: number) => number.format(value);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatWeekdayDate = (iso: string) => weekdayDate.format(new Date(iso));
export const formatTimeRange = (startIso: string, endIso: string) =>
  `${time.format(new Date(startIso))} to ${time.format(new Date(endIso))}`;

export const roleLabel: Record<AppRole, string> = {
  beneficiary: "Beneficiary",
  shop_admin: "Shop administrator",
  warehouse_admin: "Warehouse administrator",
};

export const movementKindLabel: Record<MovementKind, string> = {
  opening_balance: "Opening balance",
  receipt: "Received from warehouse",
  distribution: "Distributed",
  adjustment: "Adjustment",
};

/** "+500 kg" / "−120.5 kg", with a true minus sign. */
export const formatDelta = (value: number, unit: string) =>
  `${value > 0 ? "+" : "−"}${formatQuantity(Math.abs(value))} ${unit}`;

const fileSize = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${fileSize.format(bytes / 1024)} KB` : `${fileSize.format(bytes / 1024 / 1024)} MB`;

const dateOnly = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
/** "11 Nov 2026" from an ISO date ("2026-11-11") or timestamp. */
export const formatDate = (value: string) =>
  dateOnly.format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+05:30` : value));

export const warehouseMovementKindLabel: Record<WarehouseMovementKind, string> = {
  opening_balance: "Opening balance",
  receipt: "Received",
  adjustment: "Adjustment",
  dispatch: "Dispatched",
};

/** Today in India Standard Time, as YYYY-MM-DD. */
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
