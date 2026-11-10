"use client";

import type { Commodity } from "@rationsync/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Field, SelectField, TextareaField } from "@/components/field";
import { FormStatus, useFormAction } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { recordMovement, updateThreshold } from "@/lib/shop-actions";

type Kind = "opening_balance" | "distribution" | "adjustment";

/**
 * Records one movement. An idempotency key is created on the first submit of an entry and
 * reused for retries of that entry, so a double submit or a resent request is applied once.
 * It is cleared once the entry is accepted.
 */
export function MovementForm({ commodity, stocked }: { commodity: Commodity; stocked: boolean }) {
  const { state, onSubmit, pending, errorFor } = useFormAction(recordMovement);
  const [kind, setKind] = useState<Kind>(stocked ? "distribution" : "opening_balance");
  const form = useRef<HTMLFormElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const entryKey = useRef<string | null>(null);

  useEffect(() => {
    if (state.status === "success" || state.status === "preview") {
      form.current?.reset();
      entryKey.current = null;
    }
  }, [state]);

  function submit(event: FormEvent<HTMLFormElement>) {
    entryKey.current ??= crypto.randomUUID();
    if (keyInput.current) keyInput.current.value = entryKey.current;
    onSubmit(event);
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="space-y-5">
      <input type="hidden" name="commodityCode" value={commodity.code} />
      <input type="hidden" name="commodityName" value={commodity.nameEn} />
      <input type="hidden" name="unit" value={commodity.unit} />
      <input ref={keyInput} type="hidden" name="idempotencyKey" />
      <FormStatus state={state} />

      {stocked ? (
        <SelectField id="kind" label="Type" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="distribution">Distributed to beneficiaries</option>
          <option value="adjustment">Adjustment (damage, spoilage, recount)</option>
        </SelectField>
      ) : (
        <>
          <input type="hidden" name="kind" value="opening_balance" />
          <p className="text-[0.9375rem] text-muted-foreground">
            Record the stock you hold now. An opening balance can be entered once per commodity.
          </p>
        </>
      )}

      {kind === "adjustment" && (
        <fieldset className="space-y-2">
          <legend className="text-[0.9375rem] font-medium">Direction</legend>
          <div className="flex flex-wrap gap-2">
            {[
              ["decrease", "Remove stock"],
              ["increase", "Add stock"],
            ].map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 has-checked:border-primary has-checked:bg-primary-tint/60"
              >
                <input type="radio" name="direction" value={value} defaultChecked={value === "decrease"} className="accent-primary" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <Field
        id="quantity"
        label={`Quantity (${commodity.unit})`}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        className="max-w-48 tabular-nums"
        error={errorFor("quantity")}
      />
      <TextareaField
        id="reason"
        label="Reason"
        rows={2}
        hint={kind === "distribution" ? "For example: morning session, AAY cards" : "Say what happened"}
        error={errorFor("reason")}
      />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Record movement
      </Button>
    </form>
  );
}

export function ThresholdForm({ commodity, current }: { commodity: Commodity; current: number }) {
  const { state, onSubmit, pending, errorFor } = useFormAction(updateThreshold);
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <input type="hidden" name="commodityCode" value={commodity.code} />
      <input type="hidden" name="unit" value={commodity.unit} />
      <FormStatus state={state} />
      <Field
        id="lowStockThreshold"
        label={`Threshold (${commodity.unit})`}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        defaultValue={current}
        className="max-w-48 tabular-nums"
        hint="An alert opens when stock is at or below this quantity, and closes once it rises above."
        error={errorFor("lowStockThreshold")}
      />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Save threshold
      </Button>
    </form>
  );
}
