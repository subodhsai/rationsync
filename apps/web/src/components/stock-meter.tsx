import { stockLevel } from "@rationsync/shared";
import { cn } from "@/lib/utils";

const fill = { ok: "bg-primary", low: "bg-warning", out: "bg-destructive" } as const;

/**
 * Quantity against the shop's low-stock threshold. The scale runs to twice the threshold
 * (or the quantity, if higher), so the threshold tick sits at a stable, readable point.
 * Decorative: the table row states the same values in text.
 */
export function StockMeter({ quantity, threshold, className }: { quantity: number; threshold: number; className?: string }) {
  const scale = Math.max(threshold * 2, quantity, 1);
  const level = stockLevel(quantity, threshold);
  return (
    <div aria-hidden="true" className={cn("relative h-1.5 w-full rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full", fill[level])} style={{ width: `${(quantity / scale) * 100}%` }} />
      {threshold > 0 && (
        <div
          className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground/60"
          style={{ left: `calc(${(threshold / scale) * 100}% - 1px)` }}
        />
      )}
    </div>
  );
}
