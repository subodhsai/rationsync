import { FlaskConical } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/env";

/** Shown on every page: this is a prototype, never an official service. */
export function PrototypeNotice() {
  return (
    <p className="border-b border-border bg-card px-4 py-1.5 text-center text-[0.8125rem] text-muted-foreground">
      Educational prototype. Not an official Government of Karnataka service.
    </p>
  );
}

/** Shown wherever fixtures stand in for database records. */
export function DemoDataNotice() {
  if (isSupabaseConfigured) return null;
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning"
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Demo data.</span> Fictional records for preview. Sign-in and live data turn on
        once Supabase is configured.
      </p>
    </div>
  );
}
