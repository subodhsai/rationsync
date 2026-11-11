import { stockLevel, type WarehouseMovement, type WarehouseStockItem } from "@rationsync/shared";
import Link from "next/link";
import { EmptyState } from "@/components/page";
import { StockLevelLabel } from "@/components/status";
import { Qty } from "@/components/supply-lists";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatDelta, formatQuantity, warehouseMovementKindLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const availableFill = { ok: "bg-primary", low: "bg-warning", out: "bg-destructive" } as const;

/**
 * Stock on hand split into what is free to allocate and what is reserved for approved
 * requests, with a tick at the warehouse's low-stock threshold. Decorative: the same values
 * are always written next to it.
 */
export function WarehouseStockBar({ item, className }: { item: WarehouseStockItem; className?: string }) {
  const scale = Math.max(item.onHand, item.lowStockThreshold * 2, 1);
  const level = stockLevel(item.available, item.lowStockThreshold);
  return (
    <div aria-hidden="true" className={cn("relative h-2 w-full rounded-full bg-muted", className)}>
      <div className="flex h-full overflow-hidden rounded-full">
        <div className={availableFill[level]} style={{ width: `${(item.available / scale) * 100}%` }} />
        <div className="bg-muted-foreground/45" style={{ width: `${(item.reserved / scale) * 100}%` }} />
      </div>
      {item.lowStockThreshold > 0 && (
        <div
          className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground/60"
          style={{ left: `calc(${(item.lowStockThreshold / scale) * 100}% - 1px)` }}
        />
      )}
    </div>
  );
}

export function StockBarLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-primary" aria-hidden="true" /> Available to allocate
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-muted-foreground/45" aria-hidden="true" /> Reserved for approved requests
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-0.5 rounded-full bg-foreground/60" aria-hidden="true" /> Low-stock threshold
      </span>
      <span>Low means available stock is at or below the threshold.</span>
    </p>
  );
}

const href = (i: WarehouseStockItem) => `/warehouse/inventory/${i.warehouseId}/${i.commodityCode}`;

export function WarehouseStockTable({ items, showWarehouse }: { items: WarehouseStockItem[]; showWarehouse: boolean }) {
  if (items.length === 0) {
    return <EmptyState title="No warehouse stock recorded yet">Open a commodity to record its opening balance.</EmptyState>;
  }
  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
        {items.map((i) => (
          <li key={`${i.warehouseId}-${i.commodityCode}`}>
            <Link href={href(i)} className="block space-y-3 p-4 transition-colors duration-150 hover:bg-muted/50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-primary">{i.nameEn}</p>
                  {showWarehouse && <p className="text-[0.8125rem] text-muted-foreground">{i.warehouseName}</p>}
                </div>
                <StockLevelLabel level={stockLevel(i.available, i.lowStockThreshold)} />
              </div>
              <WarehouseStockBar item={i} />
              <dl className="grid grid-cols-3 gap-2 text-[0.8125rem]">
                {[
                  ["Available", i.available],
                  ["Reserved", i.reserved],
                  ["In transit", i.inTransit],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-[0.9375rem]">
                      <Qty value={value as number} unit={i.unit} />
                    </dd>
                  </div>
                ))}
              </dl>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table className="text-[0.9375rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 pl-4">Commodity</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="w-[24%]">Available against threshold</TableHead>
              <TableHead className="pr-4 text-right">In transit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={`${i.warehouseId}-${i.commodityCode}`}>
                <TableCell className="py-3 pl-4">
                  <Link href={href(i)} className="font-medium text-primary underline-offset-4 hover:underline">
                    {i.nameEn}
                  </Link>
                  <p lang="kn" className="text-[0.8125rem] text-muted-foreground">
                    {i.nameKn}
                    {showWarehouse && <span lang="en"> · {i.warehouseName}</span>}
                  </p>
                </TableCell>
                <TableCell className="text-right">
                  <Qty value={i.onHand} unit={i.unit} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  <Qty value={i.reserved} unit={i.unit} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Qty value={i.available} unit={i.unit} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <WarehouseStockBar item={i} className="min-w-16 flex-1" />
                    <StockLevelLabel level={stockLevel(i.available, i.lowStockThreshold)} />
                  </div>
                  <p className="mt-1 text-[0.8125rem] text-muted-foreground tabular-nums">
                    Threshold {formatQuantity(i.lowStockThreshold)} {i.unit}
                  </p>
                </TableCell>
                <TableCell className="pr-4 text-right text-muted-foreground">
                  <Qty value={i.inTransit} unit={i.unit} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** The warehouse's append-only ledger: receipts, adjustments and dispatches. */
export function WarehouseMovementList({ items }: { items: WarehouseMovement[] }) {
  if (items.length === 0) return <EmptyState title="No movements yet">Opening balances, receipts and dispatches appear here.</EmptyState>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((m) => (
        <li key={m.id} className="grid gap-1 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">
              {warehouseMovementKindLabel[m.kind]}
              {m.reference &&
                (m.shipmentId ? (
                  <Link href={`/warehouse/shipments/${m.shipmentId}`} className="ml-2 font-mono text-[0.875rem] font-normal text-primary underline-offset-4 hover:underline">
                    {m.reference}
                  </Link>
                ) : (
                  <span className="ml-2 font-mono text-[0.875rem] font-normal text-muted-foreground">{m.reference}</span>
                ))}
            </p>
            <p className="text-[0.9375rem]">{m.reason}</p>
            <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
              {formatDateTime(m.createdAt)} · {m.actorName ?? "System"}
            </p>
          </div>
          <div className="sm:text-right">
            <p className={cn("font-medium tabular-nums", m.quantityDelta > 0 && "text-primary")}>{formatDelta(m.quantityDelta, m.unit)}</p>
            <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
              On hand after {formatQuantity(m.balanceAfter)} {m.unit}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
