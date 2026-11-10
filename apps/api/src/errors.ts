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
};

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
