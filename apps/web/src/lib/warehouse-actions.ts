"use server";

import { reviewDecisionSchema } from "@rationsync/shared";
import { refresh } from "next/cache";
import { invalid, preview, type ActionState } from "@/lib/action-state";
import { ApiError, apiSend } from "@/lib/api";
import { requireRole } from "@/lib/session";

export async function reviewApplication(shopId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("warehouse_admin");
  const parsed = reviewDecisionSchema.safeParse({ decision: formData.get("decision"), reason: formData.get("reason") });
  if (!parsed.success) return invalid(parsed.error);
  const verb = parsed.data.decision === "approved" ? "approved" : "rejected";

  if (session.mode === "demo") return preview(`the application would be ${verb} with your reason recorded.`);
  try {
    // The API decides scope from the session; shopId only names the application.
    await apiSend("POST", `/api/v1/warehouse/shops/${encodeURIComponent(shopId)}/review`, session.accessToken, parsed.data);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return { status: "error", message: err.message };
  }
  refresh();
  return { status: "success", message: `Application ${verb}. The shop administrator has been notified.` };
}
