"use client";

import { CircleAlert, CircleCheck, FlaskConical } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { idle, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

const styles = {
  error: { className: "border-destructive/30 bg-destructive-tint text-destructive", icon: CircleAlert },
  success: { className: "border-primary/25 bg-primary-tint text-primary", icon: CircleCheck },
  preview: { className: "border-warning/30 bg-warning-tint text-warning", icon: FlaskConical },
} as const;

/** Result of the last submission. Errors take focus so keyboard and screen reader users land on them. */
export function FormStatus({ state }: { state: ActionState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error") ref.current?.focus();
  }, [state]);

  if (state.status === "idle") return null;
  const { className, icon: Icon } = styles[state.status];
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={state.status === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[0.9375rem] outline-none", className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{state.message}</p>
    </div>
  );
}

/**
 * Runs a server action from onSubmit instead of the form's action prop, so React does not
 * reset the fields: after a validation error the person keeps what they typed.
 */
export function useFormAction(action: (prev: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, formAction, pending] = useActionState(action, idle);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };
  const errorFor = (field: string) => (state.status === "error" ? state.fieldErrors?.[field] : undefined);
  return { state, onSubmit, pending, errorFor };
}
