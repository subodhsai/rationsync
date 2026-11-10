"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { TextareaField } from "@/components/field";
import { FormStatus, useFormAction } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { reviewApplication } from "@/lib/warehouse-actions";
import { cn } from "@/lib/utils";

type Decision = "approved" | "rejected";

const consequence: Record<Decision, string> = {
  approved: "The shop administrator gets inventory tools straight away.",
  rejected: "The applicant sees your reason and can correct and resubmit.",
};

/** Decision and reason first, then an explicit confirmation, because a decision cannot be changed. */
export function ReviewForm({ shopId, shopName }: { shopId: string; shopName: string }) {
  const { state, onSubmit, pending, errorFor } = useFormAction(reviewApplication.bind(null, shopId));
  const [decision, setDecision] = useState<Decision | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reasonError, setReasonError] = useState<string>();
  const reason = useRef<HTMLTextAreaElement>(null);

  if (state.status === "success" || state.status === "preview") return <FormStatus state={state} />;

  function toConfirm() {
    if ((reason.current?.value.trim().length ?? 0) < 3) {
      setReasonError("Record a reason of at least 3 characters");
      reason.current?.focus();
      return;
    }
    setReasonError(undefined);
    setConfirming(true);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormStatus state={state} />
      <input type="hidden" name="decision" value={decision ?? ""} />

      <fieldset className="space-y-2" disabled={confirming}>
        <legend className="sr-only">Decision</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["approved", "rejected"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={decision === d}
              onClick={() => setDecision(d)}
              className={cn(
                "h-11 rounded-lg border text-[0.9375rem] font-medium transition-colors duration-150 disabled:opacity-60",
                decision === d
                  ? d === "approved"
                    ? "border-primary bg-primary-tint text-primary"
                    : "border-destructive bg-destructive-tint text-destructive"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              {d === "approved" ? "Approve" : "Reject"}
            </button>
          ))}
        </div>
      </fieldset>

      <TextareaField
        ref={reason}
        id="reason"
        label="Reason"
        rows={3}
        readOnly={confirming}
        hint="Shown to the applicant and kept in the decision history."
        error={reasonError ?? errorFor("reason")}
      />

      {decision && !confirming && (
        <Button type="button" onClick={toConfirm} className="w-full">
          Continue
        </Button>
      )}

      {decision && confirming && (
        <div
          role="group"
          aria-label="Confirm decision"
          className={cn(
            "space-y-3 rounded-lg border p-3",
            decision === "approved" ? "border-primary/30 bg-primary-tint/50" : "border-destructive/30 bg-destructive-tint/60",
          )}
        >
          <p className="text-[0.9375rem]">
            <span className="font-medium">
              {decision === "approved" ? "Approve" : "Reject"} {shopName}?
            </span>{" "}
            {consequence[decision]} This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending} variant={decision === "approved" ? "default" : "destructive"}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {decision === "approved" ? "Confirm approval" : "Confirm rejection"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
