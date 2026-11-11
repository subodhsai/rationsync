import { idempotencyKeySchema } from "@rationsync/shared";
import type { Request } from "express";
import { HttpError } from "./errors.js";

export function idempotencyKeyOf(req: Request): string {
  const key = idempotencyKeySchema.safeParse(req.get("idempotency-key"));
  if (!key.success) {
    throw new HttpError(400, "idempotency_key_required", "Send an Idempotency-Key header between 8 and 100 characters.");
  }
  return key.data;
}

/**
 * Runs a database write whose function returns the earlier row for a repeated key. If a
 * concurrent request with the same key inserted first, the unique constraint fires instead;
 * answer with that request's row rather than an error.
 */
export async function idempotentWrite(
  write: () => Promise<string>,
  keyConstraint: string,
  existing: () => Promise<string>,
): Promise<string> {
  try {
    return await write();
  } catch (err) {
    if ((err as { constraint?: string }).constraint !== keyConstraint) throw err;
    return existing();
  }
}
