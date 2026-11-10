import type { StockMovement } from "@rationsync/shared";
import { EmptyState } from "@/components/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatDelta, formatQuantity, movementKindLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

function Delta({ m }: { m: StockMovement }) {
  return (
    <span className={cn("font-medium tabular-nums", m.quantityDelta < 0 ? "text-foreground" : "text-primary")}>
      {formatDelta(m.quantityDelta, m.unit)}
    </span>
  );
}

/** The append-only ledger: who changed what, by how much, and why. */
export function MovementList({ items, showCommodity = true }: { items: StockMovement[]; showCommodity?: boolean }) {
  if (items.length === 0) {
    return <EmptyState title="No movements yet">Opening balances, distributions and adjustments appear here.</EmptyState>;
  }
  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
        {items.map((m) => (
          <li key={m.id} className="space-y-1 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">
                {showCommodity && `${m.commodityName} · `}
                {movementKindLabel[m.kind]}
              </p>
              <Delta m={m} />
            </div>
            <p className="text-[0.9375rem]">{m.reason}</p>
            <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
              {formatDateTime(m.createdAt)} · {m.actorName ?? "System"} · balance {formatQuantity(m.balanceAfter)} {m.unit}
            </p>
          </li>
        ))}
      </ul>

      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table className="text-[0.9375rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 pl-4">When</TableHead>
              {showCommodity && <TableHead>Commodity</TableHead>}
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
              <TableHead className="pr-4">Reason and recorded by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m) => (
              <TableRow key={m.id} className="align-top">
                <TableCell className="py-3 pl-4 whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatDateTime(m.createdAt)}
                </TableCell>
                {showCommodity && <TableCell className="py-3 font-medium">{m.commodityName}</TableCell>}
                <TableCell className="py-3">{movementKindLabel[m.kind]}</TableCell>
                <TableCell className="py-3 text-right">
                  <Delta m={m} />
                </TableCell>
                <TableCell className="py-3 text-right tabular-nums">
                  {formatQuantity(m.balanceAfter)} <span className="font-mono text-[0.8125rem] text-muted-foreground">{m.unit}</span>
                </TableCell>
                <TableCell className="py-3 pr-4 whitespace-normal">
                  <p>{m.reason}</p>
                  <p className="text-[0.8125rem] text-muted-foreground">{m.actorName ?? "System"}</p>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
