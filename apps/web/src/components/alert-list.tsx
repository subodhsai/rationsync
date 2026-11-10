import { stockLevel, type StockAlert } from "@rationsync/shared";
import Link from "next/link";
import { EmptyState } from "@/components/page";
import { AlertStatusLabel, StockLevelLabel } from "@/components/status";
import { StockMeter } from "@/components/stock-meter";
import { formatDateTime, formatQuantity } from "@/lib/format";

/**
 * Alerts as rows, most urgent first (ordering comes from the API). `linkTo` decides where a
 * row leads: the shop's own commodity page, or the warehouse's shop detail.
 */
export function AlertList({
  items,
  showShop,
  linkTo,
  emptyTitle,
}: {
  items: StockAlert[];
  showShop: boolean;
  linkTo: (a: StockAlert) => string;
  emptyTitle: string;
}) {
  if (items.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((a) => {
        const level = stockLevel(a.currentQuantity, a.currentThreshold);
        return (
          <li key={a.id}>
            <Link
              href={linkTo(a)}
              className="grid gap-3 p-4 transition-colors duration-150 hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {a.commodityName}
                  {showShop && <span className="font-normal text-muted-foreground"> at {a.shopName}</span>}
                </p>
                <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                  {showShop && <span className="font-mono">{a.fpsId} · </span>}
                  Opened {formatDateTime(a.openedAt)}
                  {a.resolvedAt && <> · resolved {formatDateTime(a.resolvedAt)}</>}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-[0.875rem] tabular-nums">
                  {formatQuantity(a.currentQuantity)} {a.unit}
                  <span className="text-muted-foreground">
                    {" "}
                    of {formatQuantity(a.currentThreshold)} {a.unit} threshold
                  </span>
                </p>
                <StockMeter quantity={a.currentQuantity} threshold={a.currentThreshold} />
              </div>
              <div className="flex gap-2 sm:justify-end">
                {a.status === "open" ? <StockLevelLabel level={level} /> : <AlertStatusLabel status="resolved" />}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AlertRuleNote() {
  return (
    <p className="text-[0.8125rem] text-muted-foreground">
      An alert opens when a stock movement or threshold change leaves the quantity at or below the shop&apos;s
      threshold, and resolves automatically once it rises above. Most urgent first: out of stock, then the smallest share
      of the threshold remaining.
    </p>
  );
}
