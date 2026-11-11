import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiErrorBody } from "@rationsync/shared";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// Database functions raise P0001 with a machine-readable hint and a readable message.
const hintStatus: Record<string, number> = {
  shop_not_approved: 403,
  shop_not_found: 404,
  registration_exists: 409,
  already_decided: 409,
  commodity_not_stocked: 409,
  slot_unavailable: 409,
  invalid_decision: 400,
  // Phase 3
  warehouse_not_found: 404,
  request_not_found: 404,
  shipment_not_found: 404,
  discrepancy_not_found: 404,
  request_not_pending: 409,
  insufficient_warehouse_stock: 409,
  request_not_shippable: 409,
  already_dispatched: 409,
  invalid_transition: 409,
  already_received: 409,
  not_receivable: 409,
  already_resolved: 409,
  invalid_quantity: 400,
  invalid_date: 400,
  invalid_movement: 400,
  no_items: 400,
  items_mismatch: 400,
  receipt_exceeds_dispatch: 400,
  note_required: 400,
};

const noWarehouseStock: [number, string, string] = [
  409,
  "insufficient_warehouse_stock",
  "The warehouse does not have enough unreserved stock for this. Some may already be reserved for approved requests.",
];

const constraintErrors: Record<string, [number, string, string]> = {
  shops_fps_id_key: [409, "fps_id_taken", "A shop with this FPS ID is already registered on RationSync."],
  shops_warehouse_id_fkey: [400, "unknown_warehouse", "Choose a warehouse from the list."],
  shop_inventory_quantity_check: [409, "insufficient_stock", "There is not enough stock for this movement."],
  shop_inventory_commodity_code_fkey: [400, "unknown_commodity", "Choose a commodity from the list."],
  stock_movements_one_opening_balance: [
    409,
    "opening_balance_exists",
    "An opening balance was already recorded for this commodity. Use an adjustment instead.",
  ],
  shops_owner_id_key: [409, "registration_exists", "This account already has an application."],
  shop_inventory_target_above_threshold: [400, "invalid_target", "The target must be above the low-stock threshold."],
  warehouse_inventory_reserved_within_on_hand: noWarehouseStock,
  warehouse_inventory_quantity_on_hand_check: noWarehouseStock,
  warehouse_inventory_commodity_code_fkey: [400, "unknown_commodity", "Choose a commodity from the list."],
  replenishment_requests_commodity_code_fkey: [400, "unknown_commodity", "Choose a commodity from the list."],
  warehouse_stock_movements_one_opening_balance: [
    409,
    "opening_balance_exists",
    "An opening balance was already recorded for this commodity. Use a receipt or an adjustment instead.",
  ],
  replenishment_requests_one_open: [
    409,
    "request_exists",
    "There is already an open request for this commodity. Wait for it to be decided, or cancel it first.",
  ],
  shipment_items_receipt_within_dispatched: [
    400,
    "receipt_exceeds_dispatch",
    "Received and damaged quantities cannot add up to more than was dispatched.",
  ],
};

export function fromDbError(err: unknown): HttpError | undefined {
  if (!err || typeof err !== "object") return undefined;
  const { code, hint, constraint, message } = err as { code?: string; hint?: string; constraint?: string; message?: string };
  if (code === "P0001" && hint && hintStatus[hint]) return new HttpError(hintStatus[hint], hint, message ?? hint);
  const known = constraint ? constraintErrors[constraint] : undefined;
  return known ? new HttpError(...known) : undefined;
}

export const notFound: RequestHandler = (req) => {
  throw new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`);
};

export const errorHandler: ErrorRequestHandler = (thrown, req, res, _next) => {
  const err = fromDbError(thrown) ?? thrown;
  let status = 500;
  let body: ApiErrorBody = {
    error: { code: "internal_error", message: "Something went wrong on our side. Try again in a moment." },
  };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: "validation_failed",
        message: "Some fields are missing or invalid.",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  } else if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    status = err.status ?? 400;
    body = { error: { code: "invalid_body", message: "The request body could not be read." } };
  }

  if (status === 500) req.log.error({ err }, "unhandled error");
  res.status(status).json(body);
};
