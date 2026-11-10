import type { AppRole, MovementKind } from "@rationsync/shared";

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
