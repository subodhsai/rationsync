"use server";

import {
  createShipmentSchema,
  dispatchShipmentSchema,
  reasonOnlySchema,
  receiveShipmentSchema,
  replenishmentRequestSchema,
  requestDecisionSchema,
  resolveDiscrepancySchema,
  thresholdSchema,
  warehouseMovementDelta,
  warehouseMovementSchema,
} from "@rationsync/shared";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { invalid, preview, type ActionState } from "@/lib/action-state";
import { entries, fromApiError } from "@/lib/action-helpers";
import { apiSend } from "@/lib/api";
import { formatQuantity } from "@/lib/format";
import { getSession, requireApprovedShop, requireRole } from "@/lib/session";
import { demoShipmentDetails, demoShopRequests, demoWarehouseMovements, demoWarehouseStock } from "@/lib/supply-fixtures";

const kg = (n: number, unit: string) => `${formatQuantity(n)} ${unit}`;
const done = (message: string): ActionState => {
  refresh();
  return { status: "success", message };
};

// Shop administrator ----------------------------------------------------------

export async function createRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const values = entries(formData);
  const parsed = replenishmentRequestSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const amount = kg(parsed.data.quantity, values.unit ?? "");

  if (session.mode === "demo") {
    const open = demoShopRequests.find(
      (r) => r.commodityCode === parsed.data.commodityCode && (r.status === "pending" || r.status === "approved"),
    );
    if (open) {
      return { status: "error", message: `${open.reference} is still open for this commodity. Wait for it to be decided, or cancel it first.` };
    }
    return preview(`a ${parsed.data.priority}-priority request for ${amount} would go to the warehouse for review.`);
  }

  let id: string;
  try {
    ({ request: { id } } = await apiSend<{ request: { id: string } }>("POST", "/api/v1/shop/requests", session.accessToken, parsed.data, {
      "Idempotency-Key": values.idempotencyKey ?? "",
    }));
  } catch (err) {
    return fromApiError(err);
  }
  redirect(`/shop/requests/${id}?submitted=1`);
}

export async function cancelRequest(requestId: string, _prev: ActionState): Promise<ActionState> {
  const session = await requireApprovedShop();
  if (session.mode === "demo") return preview("the request would be cancelled.");
  try {
    await apiSend("POST", `/api/v1/shop/requests/${encodeURIComponent(requestId)}/cancel`, session.accessToken, {});
  } catch (err) {
    return fromApiError(err);
  }
  return done("Request cancelled. The warehouse no longer sees it as pending.");
}

/** Reads one received and damaged quantity per shipment item; fields are named by item id. */
function receiptInput(formData: FormData) {
  const ids = formData.getAll("itemId").map(String);
  return {
    items: ids.map((itemId) => ({
      itemId,
      receivedQuantity: formData.get(`received-${itemId}`),
      damagedQuantity: formData.get(`damaged-${itemId}`) || "0",
    })),
    note: String(formData.get("note") ?? ""),
  };
}

export async function receiveShipment(shipmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const input = receiptInput(formData);
  const parsed = receiveShipmentSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const [, index, field] = issue.path;
      const id = typeof index === "number" ? input.items[index]?.itemId : undefined;
      const prefix = field === "receivedQuantity" ? "received" : field === "damagedQuantity" ? "damaged" : null;
      if (id && prefix) fieldErrors[`${prefix}-${id}`] ??= issue.message;
    }
    return { status: "error", message: "Enter what arrived for every item, in kilograms. Use 0 where nothing arrived.", fieldErrors };
  }

  if (session.mode === "demo") {
    const shipment = demoShipmentDetails.find((s) => s.id === shipmentId);
    let discrepancies = 0;
    for (const input of parsed.data.items) {
      const item = shipment?.detailItems.find((i) => i.id === input.itemId);
      if (!item) continue;
      if (input.receivedQuantity + input.damagedQuantity > item.quantity) {
        return {
          status: "error",
          message: "Received and damaged quantities cannot add up to more than was dispatched.",
          fieldErrors: { [`received-${item.id}`]: `No more than ${kg(item.quantity, item.unit)} in total` },
        };
      }
      if (input.receivedQuantity + input.damagedQuantity < item.quantity || input.damagedQuantity > 0) discrepancies++;
    }
    if (discrepancies > 0 && (parsed.data.note?.length ?? 0) < 3) {
      return { status: "error", message: "Say what was missing or damaged.", fieldErrors: { note: "Required when anything is short or damaged" } };
    }
    return preview(
      discrepancies > 0
        ? `the good quantities would be added to your stock and ${discrepancies} discrepancy record${discrepancies === 1 ? "" : "s"} sent to the warehouse.`
        : "the full shipment would be added to your stock.",
    );
  }

  try {
    await apiSend("POST", `/api/v1/shop/shipments/${encodeURIComponent(shipmentId)}/receive`, session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err, { note_required: "note" });
  }
  return done("Delivery confirmed. Stock in good condition was added to your inventory.");
}

export async function disputeShipment(shipmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const parsed = reasonOnlySchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return invalid(parsed.error);
  if (session.mode === "demo") return preview("the shipment would be marked disputed and the warehouse notified.");
  try {
    await apiSend("POST", `/api/v1/shop/shipments/${encodeURIComponent(shipmentId)}/dispute`, session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  return done("Reported to the warehouse. You can still confirm the delivery when it arrives.");
}

// Warehouse administrator -----------------------------------------------------

export async function decideRequest(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  const values = entries(formData);
  const parsed = requestDecisionSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const unit = values.unit ?? "";

  if (session.mode === "demo") {
    if (parsed.data.decision === "rejected") return preview("the request would be rejected and the shop shown your reason.");
    const requested = Number(values.requestedQuantity);
    const available = demoWarehouseStock.find((w) => w.commodityCode === values.commodityCode)?.available ?? 0;
    if (parsed.data.approvedQuantity > requested) {
      return { status: "error", message: `Approve at most the ${kg(requested, unit)} requested.`, fieldErrors: { approvedQuantity: `At most ${kg(requested, unit)}` } };
    }
    if (parsed.data.approvedQuantity > available) {
      return {
        status: "error",
        message: "The warehouse does not have enough unreserved stock for this. Some may already be reserved for approved requests.",
        fieldErrors: { approvedQuantity: `${kg(available, unit)} available` },
      };
    }
    return preview(`${kg(parsed.data.approvedQuantity, unit)} would be reserved for this shop. Nothing moves until you dispatch.`);
  }

  try {
    await apiSend("POST", `/api/v1/warehouse/requests/${encodeURIComponent(requestId)}/decision`, session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err, { insufficient_warehouse_stock: "approvedQuantity", invalid_quantity: "approvedQuantity" });
  }
  return done(
    parsed.data.decision === "approved"
      ? `Approved. ${kg(parsed.data.approvedQuantity, unit)} is reserved; create a shipment to dispatch it.`
      : "Rejected. The shop administrator has been notified with your reason.",
  );
}

export async function createShipment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  const values = entries(formData);
  const parsed = createShipmentSchema.safeParse({ ...values, requestIds: formData.getAll("requestIds").map(String) });
  if (!parsed.success) return invalid(parsed.error);
  const count = parsed.data.requestIds.length;
  if (session.mode === "demo") {
    return preview(`a shipment of ${count} request${count === 1 ? "" : "s"} would be prepared. Stock stays reserved until you dispatch it.`);
  }

  let id: string;
  try {
    ({ shipment: { id } } = await apiSend<{ shipment: { id: string } }>("POST", "/api/v1/warehouse/shipments", session.accessToken, parsed.data, {
      "Idempotency-Key": values.idempotencyKey ?? "",
    }));
  } catch (err) {
    return fromApiError(err, { invalid_date: "expectedDeliveryDate" });
  }
  redirect(`/warehouse/shipments/${id}?created=1`);
}

export async function dispatchShipment(shipmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  const parsed = dispatchShipmentSchema.safeParse({ expectedDeliveryDate: formData.get("expectedDeliveryDate") || undefined });
  if (!parsed.success) return invalid(parsed.error);
  if (session.mode === "demo") return preview("the reserved stock would leave the warehouse and the shop would be told to expect it.");
  try {
    await apiSend("POST", `/api/v1/warehouse/shipments/${encodeURIComponent(shipmentId)}/dispatch`, session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err, { invalid_date: "expectedDeliveryDate" });
  }
  return done("Dispatched. Stock left the warehouse and is now in transit. The shop has been notified.");
}

export async function markInTransit(shipmentId: string, _prev: ActionState): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  if (session.mode === "demo") return preview("the shipment would be marked in transit.");
  try {
    await apiSend("POST", `/api/v1/warehouse/shipments/${encodeURIComponent(shipmentId)}/in-transit`, session.accessToken, {});
  } catch (err) {
    return fromApiError(err);
  }
  return done("Marked in transit.");
}

export async function cancelShipment(shipmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  const parsed = reasonOnlySchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return invalid(parsed.error);
  if (session.mode === "demo") return preview("the shipment would be cancelled. Its requests stay approved, with stock still reserved.");
  try {
    await apiSend("POST", `/api/v1/warehouse/shipments/${encodeURIComponent(shipmentId)}/cancel`, session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  return done("Shipment cancelled. Its requests are back in the dispatch queue with stock still reserved.");
}

export async function resolveDiscrepancy(discrepancyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  const parsed = resolveDiscrepancySchema.safeParse({ resolution: formData.get("resolution") });
  if (!parsed.success) return invalid(parsed.error);
  if (session.mode === "demo") return preview("the resolution would be recorded. No stock moves.");
  try {
    await apiSend("POST", `/api/v1/warehouse/discrepancies/${encodeURIComponent(discrepancyId)}/resolve`, session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  return done("Resolution recorded.");
}

export async function recordWarehouseMovement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  const values = entries(formData);
  const parsed = warehouseMovementSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const unit = values.unit ?? "";
  const delta = warehouseMovementDelta(parsed.data);
  const verb = parsed.data.kind === "receipt" ? "a receipt of" : parsed.data.kind === "opening_balance" ? "an opening balance of" : delta > 0 ? "an increase of" : "a decrease of";

  if (session.mode === "demo") {
    const stock = demoWarehouseStock.find((w) => w.warehouseId === values.warehouseId && w.commodityCode === parsed.data.commodityCode);
    const hasOpening = demoWarehouseMovements.some(
      (m) => m.warehouseId === values.warehouseId && m.commodityCode === parsed.data.commodityCode && m.kind === "opening_balance",
    );
    if (parsed.data.kind === "opening_balance" && hasOpening) {
      return { status: "error", message: "An opening balance was already recorded for this commodity. Use a receipt or an adjustment instead." };
    }
    if (delta < 0 && -delta > (stock?.available ?? 0)) {
      return {
        status: "error",
        message: "The warehouse does not have enough unreserved stock for this. Some may already be reserved for approved requests.",
        fieldErrors: { quantity: `${kg(stock?.available ?? 0, unit)} available` },
      };
    }
    return preview(`this would record ${verb} ${kg(parsed.data.quantity, unit)}.`);
  }

  try {
    await apiSend("POST", "/api/v1/warehouse/movements", session.accessToken, { ...parsed.data, warehouseId: values.warehouseId }, {
      "Idempotency-Key": values.idempotencyKey ?? "",
    });
  } catch (err) {
    return fromApiError(err, { insufficient_warehouse_stock: "quantity" });
  }
  return done(`Recorded ${verb} ${kg(parsed.data.quantity, unit)}.`);
}

export async function updateWarehouseThreshold(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  const values = entries(formData);
  const parsed = thresholdSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const amount = kg(parsed.data.lowStockThreshold, values.unit ?? "");
  if (session.mode === "demo") return preview(`the warehouse threshold would become ${amount}.`);
  try {
    await apiSend(
      "PATCH",
      `/api/v1/warehouse/inventory/${encodeURIComponent(values.warehouseId ?? "")}/${encodeURIComponent(values.commodityCode ?? "")}/threshold`,
      session.accessToken,
      parsed.data,
    );
  } catch (err) {
    return fromApiError(err);
  }
  return done(`Warehouse threshold set to ${amount}.`);
}

// Both roles ------------------------------------------------------------------

export async function markNotificationsRead(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mode === "demo") return; // preview notifications are fixtures; nothing to save
  await apiSend("POST", "/api/v1/notifications/read", session.accessToken, {});
  refresh();
}
