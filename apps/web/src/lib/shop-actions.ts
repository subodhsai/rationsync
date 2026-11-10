"use server";

import {
  movementDelta,
  shopRegistrationSchema,
  stockMovementSchema,
  thresholdSchema,
  type StockMovementInput,
} from "@rationsync/shared";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, preview, type ActionState } from "@/lib/action-state";
import { ApiError, apiSend } from "@/lib/api";
import { demoInventory } from "@/lib/fixtures";
import { formatDelta, formatQuantity } from "@/lib/format";
import { requireApprovedShop, requireRole } from "@/lib/session";

function fromApiError(err: unknown): ActionState {
  if (!(err instanceof ApiError)) throw err;
  const fieldErrors: Record<string, string> = {};
  if (Array.isArray(err.details)) {
    for (const d of err.details as Array<{ path?: string; message?: string }>) {
      if (d.path && d.message) fieldErrors[d.path] ??= d.message;
    }
  }
  if (err.code === "fps_id_taken") fieldErrors.fpsId = err.message;
  return { status: "error", message: err.message, fieldErrors };
}

const entries = (formData: FormData) =>
  Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

export async function submitRegistration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("shop_admin");
  const parsed = shopRegistrationSchema.safeParse(entries(formData));
  if (!parsed.success) return invalid(parsed.error);
  if (session.mode === "demo") {
    return preview(`the application for ${parsed.data.fpsId} would be sent to the warehouse for review.`);
  }

  try {
    await apiSend("POST", "/api/v1/registration", session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  redirect("/shop/status?submitted=1");
}

const documentInput = z.object({ storagePath: z.string().min(3), fileName: z.string().min(1) });

/** Called after the browser has uploaded the file to Storage with its own session. */
export async function recordDocument(input: { storagePath: string; fileName: string }): Promise<ActionState> {
  const session = await requireRole("shop_admin");
  const parsed = documentInput.safeParse(input);
  if (!parsed.success || session.mode === "demo") return { status: "error", message: "That upload could not be recorded." };
  try {
    await apiSend("POST", "/api/v1/registration/documents", session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  refresh();
  return { status: "success", message: `${parsed.data.fileName} was added to your application.` };
}

function describe(input: StockMovementInput, name: string, unit: string): string {
  const amount = `${formatQuantity(input.quantity)} ${unit} of ${name.toLowerCase()}`;
  if (input.kind === "opening_balance") return `an opening balance of ${amount}`;
  if (input.kind === "distribution") return `a distribution of ${amount}`;
  return `an adjustment ${input.direction === "increase" ? "adding" : "removing"} ${amount}`;
}

export async function recordMovement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const values = entries(formData);
  const parsed = stockMovementSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const summary = describe(parsed.data, values.commodityName ?? parsed.data.commodityCode, values.unit ?? "");

  if (session.mode === "demo") {
    // Same outcomes the API would give, checked against the fixture balance.
    const delta = movementDelta(parsed.data);
    const current = demoInventory.find((i) => i.commodityCode === parsed.data.commodityCode);
    if (parsed.data.kind === "opening_balance" && current) {
      return { status: "error", message: "An opening balance was already recorded for this commodity. Use an adjustment instead." };
    }
    if ((current?.quantity ?? 0) + delta < 0) {
      return { status: "error", message: "There is not enough stock for this movement.", fieldErrors: { quantity: `Only ${formatQuantity(current?.quantity ?? 0)} ${values.unit ?? ""} in stock` } };
    }
    return preview(`this would record ${summary}, changing stock by ${formatDelta(delta, values.unit ?? "")}.`);
  }
  try {
    await apiSend("POST", "/api/v1/shop/movements", session.accessToken, parsed.data, {
      "Idempotency-Key": values.idempotencyKey ?? "",
    });
  } catch (err) {
    return fromApiError(err);
  }
  refresh();
  return { status: "success", message: `Recorded ${summary}.` };
}

export async function updateThreshold(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const values = entries(formData);
  const parsed = thresholdSchema.safeParse(values);
  const code = values.commodityCode ?? "";
  if (!parsed.success) return invalid(parsed.error);
  const amount = `${formatQuantity(parsed.data.lowStockThreshold)} ${values.unit ?? ""}`.trim();

  if (session.mode === "demo") return preview(`the low-stock threshold would become ${amount}.`);
  try {
    await apiSend("PATCH", `/api/v1/shop/inventory/${encodeURIComponent(code)}/threshold`, session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  refresh();
  return { status: "success", message: `Threshold set to ${amount}. Alerts were re-checked.` };
}
