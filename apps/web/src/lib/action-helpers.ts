import "server-only";
import type { ActionState } from "@/lib/action-state";
import { ApiError } from "@/lib/api";

/** Turns an API refusal into form state, keeping field-level messages where the API sent them. */
export function fromApiError(err: unknown, fieldFor: Record<string, string> = {}): ActionState {
  if (!(err instanceof ApiError)) throw err;
  const fieldErrors: Record<string, string> = {};
  if (Array.isArray(err.details)) {
    for (const d of err.details as Array<{ path?: string; message?: string }>) {
      if (d.path && d.message) fieldErrors[d.path] ??= d.message;
    }
  }
  const field = fieldFor[err.code];
  if (field) fieldErrors[field] = err.message;
  return { status: "error", message: err.message, fieldErrors };
}

export const entries = (formData: FormData) =>
  Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
