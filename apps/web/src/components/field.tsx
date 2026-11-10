import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const controlClass =
  "w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base transition-colors focus-visible:border-ring aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50";

function FieldShell({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[0.9375rem]">
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
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

const describedBy = (id: string, error?: string, hint?: ReactNode) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

type Common = { id: string; label: string; hint?: ReactNode; error?: string; optional?: boolean };

/** Label, input, and hint or error text wired together for assistive technology. */
export function Field({ id, label, hint, error, optional, ...input }: ComponentProps<typeof Input> & Common) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <Input id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} {...input} />
    </FieldShell>
  );
}

export function SelectField({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className,
  ...select
}: ComponentProps<"select"> & Common) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <div className="relative">
        <select
          id={id}
          name={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(controlClass, "h-10 appearance-none pr-9", className)}
          {...select}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </FieldShell>
  );
}

export function TextareaField({ id, label, hint, error, optional, className, ...textarea }: ComponentProps<"textarea"> & Common) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass, "min-h-24 py-2", className)}
        {...textarea}
      />
    </FieldShell>
  );
}
