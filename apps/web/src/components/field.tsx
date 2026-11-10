import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Label, input, and hint or error text wired together for assistive technology. */
export function Field({
  id,
  label,
  hint,
  error,
  ...input
}: ComponentProps<typeof Input> & { id: string; label: string; hint?: string; error?: string }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[0.9375rem]">
        {label}
      </Label>
      <Input id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {error ? (
        <p id={`${id}-error`} className="text-[0.875rem] text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[0.875rem] text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
