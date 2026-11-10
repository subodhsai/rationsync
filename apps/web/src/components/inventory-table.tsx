import { stockLevel, type InventoryItem } from "@rationsync/shared";
import { StockLevelLabel } from "@/components/status";
import { StockMeter } from "@/components/stock-meter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatQuantity } from "@/lib/format";

function Commodity({ item }: { item: InventoryItem }) {
  return (
    <div>
      <p className="font-medium">{item.nameEn}</p>
      <p lang="kn" className="text-[0.8125rem] text-muted-foreground">
        {item.nameKn}
      </p>
    </div>
  );
}

function Quantity({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="tabular-nums">
      {formatQuantity(value)} <span className="font-mono text-[0.8125rem] text-muted-foreground">{unit}</span>
    </span>
  );
}

export function InventoryTable({ items, showUpdated = true }: { items: InventoryItem[]; showUpdated?: boolean }) {
  return (
    <>
      {/* Phones: one row per commodity, nothing clipped. */}
      <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
        {items.map((item) => (
          <li key={item.commodityCode} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <Commodity item={item} />
              <StockLevelLabel level={stockLevel(item.quantity, item.lowStockThreshold)} />
            </div>
            <div className="flex items-baseline justify-between text-[0.9375rem]">
              <Quantity value={item.quantity} unit={item.unit} />
              <span className="text-[0.8125rem] text-muted-foreground">
                Threshold <Quantity value={item.lowStockThreshold} unit={item.unit} />
              </span>
            </div>
            <StockMeter quantity={item.quantity} threshold={item.lowStockThreshold} />
          </li>
        ))}
      </ul>

      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table className="text-[0.9375rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 pl-4">Commodity</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Low-stock threshold</TableHead>
              <TableHead className="w-[28%]">Level</TableHead>
              {showUpdated && <TableHead className="pr-4">Last movement</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.commodityCode}>
                <TableCell className="py-3 pl-4">
                  <Commodity item={item} />
                </TableCell>
                <TableCell className="text-right">
                  <Quantity value={item.quantity} unit={item.unit} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  <Quantity value={item.lowStockThreshold} unit={item.unit} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <StockMeter quantity={item.quantity} threshold={item.lowStockThreshold} className="min-w-16 flex-1" />
                    <StockLevelLabel level={stockLevel(item.quantity, item.lowStockThreshold)} />
                  </div>
                </TableCell>
                {showUpdated && (
                  <TableCell className="pr-4 text-muted-foreground tabular-nums">{formatDateTime(item.updatedAt)}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export function StockRuleNote() {
  return (
    <p className="text-[0.8125rem] text-muted-foreground">
      Low stock means the quantity is at or below the threshold set for this shop. The tick on each bar marks the
      threshold.
    </p>
  );
}
