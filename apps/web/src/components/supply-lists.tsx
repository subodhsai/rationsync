import type { Forecast, ReplenishmentRequest, ReplenishmentSuggestion, ShipmentDetail, ShipmentSummary } from "@rationsync/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/page";
import { stockLevel } from "@rationsync/shared";
import { DiscrepancyLabel, priorityLabel, PriorityLabel, RequestStatusLabel, ShipmentStatusLabel, StockLevelLabel } from "@/components/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatQuantity, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Qty({ value, unit, className }: { value: number; unit: string; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatQuantity(value)} <span className="font-mono text-[0.8125rem] text-muted-foreground">{unit}</span>
    </span>
  );
}

const linkClass = "font-medium text-primary underline-offset-4 hover:underline";

/** Quantity column: requested, with the approved amount when it differs. */
function RequestQuantity({ r }: { r: ReplenishmentRequest }) {
  return (
    <span>
      <Qty value={r.requestedQuantity} unit={r.unit} />
      {r.approvedQuantity !== null && r.approvedQuantity !== r.requestedQuantity && (
        <span className="block text-[0.8125rem] text-muted-foreground tabular-nums">
          {formatQuantity(r.approvedQuantity)} approved
        </span>
      )}
    </span>
  );
}

/**
 * Requests as a table on wide screens and a list on phones. The warehouse variant shows the
 * shop and the priority recommended from current stock next to the one the shop chose.
 */
export function RequestTable({
  rows,
  variant,
  emptyTitle,
  children,
}: {
  rows: ReplenishmentRequest[];
  variant: "shop" | "warehouse";
  emptyTitle: string;
  children?: ReactNode;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle}>{children}</EmptyState>;
  const warehouse = variant === "warehouse";
  const href = (r: ReplenishmentRequest) => `/${variant}/requests/${r.id}`;

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={href(r)} className="block space-y-2 p-4 transition-colors duration-150 hover:bg-muted/50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-primary">
                    {r.commodityName} · <Qty value={r.requestedQuantity} unit={r.unit} className="text-foreground" />
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    <span className="font-mono">{r.reference}</span>
                    {warehouse && <> · {r.shopName}</>} · {formatDateTime(r.createdAt)}
                  </p>
                </div>
                <RequestStatusLabel status={r.status} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
                {warehouse && r.recommendation ? (
                  <>
                    Recommended <PriorityLabel priority={r.recommendation.priority} />
                  </>
                ) : (
                  <>
                    Priority <PriorityLabel priority={r.priority} />
                  </>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table className="text-[0.9375rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 pl-4">Request</TableHead>
              {warehouse && <TableHead>Shop</TableHead>}
              <TableHead>Commodity</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead>{warehouse ? "Priority: stated, recommended" : "Priority"}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4">Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell className="py-3 pl-4">
                  <Link href={href(r)} className={cn(linkClass, "font-mono text-[0.875rem]")}>
                    {r.reference}
                  </Link>
                </TableCell>
                {warehouse && (
                  <TableCell className="py-3">
                    <p>{r.shopName}</p>
                    <p className="font-mono text-[0.8125rem] text-muted-foreground">{r.fpsId}</p>
                  </TableCell>
                )}
                <TableCell className="py-3">{r.commodityName}</TableCell>
                <TableCell className="py-3 text-right">
                  <RequestQuantity r={r} />
                </TableCell>
                <TableCell className="py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <PriorityLabel priority={r.priority} />
                    {warehouse && r.recommendation && r.recommendation.priority !== r.priority && (
                      <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">recommended</span>
                        <PriorityLabel priority={r.recommendation.priority} />
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  <RequestStatusLabel status={r.status} />
                  {r.shipment && (
                    <p className="mt-1 font-mono text-[0.8125rem] text-muted-foreground">{r.shipment.reference}</p>
                  )}
                </TableCell>
                <TableCell className="py-3 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatDateTime(r.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

const itemSummary = (s: ShipmentSummary) => s.items.map((i) => `${i.commodityName} ${formatQuantity(i.quantity)} ${i.unit}`).join(", ");
const awaiting = (s: ShipmentSummary) => ["dispatched", "in_transit", "disputed"].includes(s.status);

function ExpectedDate({ s }: { s: ShipmentSummary }) {
  const overdue = awaiting(s) && s.expectedDeliveryDate < todayIst();
  return (
    <span className={cn("tabular-nums", overdue && "font-medium text-warning")}>
      {formatDate(s.expectedDeliveryDate)}
      {overdue && " · overdue"}
    </span>
  );
}

export function ShipmentTable({
  rows,
  area,
  emptyTitle,
}: {
  rows: ShipmentSummary[];
  area: "shop" | "warehouse";
  emptyTitle: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} />;
  const warehouse = area === "warehouse";
  const href = (s: ShipmentSummary) => `/${area}/shipments/${s.id}`;

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
        {rows.map((s) => (
          <li key={s.id}>
            <Link href={href(s)} className="block space-y-1.5 p-4 transition-colors duration-150 hover:bg-muted/50">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono font-medium text-primary">{s.reference}</p>
                <ShipmentStatusLabel status={s.status} />
              </div>
              {warehouse && <p className="text-[0.9375rem]">{s.shopName}</p>}
              <p className="text-[0.9375rem] tabular-nums">{itemSummary(s)}</p>
              <p className="text-[0.8125rem] text-muted-foreground">
                Expected <ExpectedDate s={s} />
                {s.openDiscrepancies > 0 && <span className="text-warning"> · {s.openDiscrepancies} open discrepancy</span>}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table className="text-[0.9375rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 pl-4">Shipment</TableHead>
              {warehouse && <TableHead>Destination shop</TableHead>}
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead className="pr-4">Dispatched</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id} className="align-top">
                <TableCell className="py-3 pl-4">
                  <Link href={href(s)} className={cn(linkClass, "font-mono text-[0.875rem]")}>
                    {s.reference}
                  </Link>
                </TableCell>
                {warehouse && (
                  <TableCell className="py-3">
                    <p>{s.shopName}</p>
                    <p className="font-mono text-[0.8125rem] text-muted-foreground">{s.fpsId}</p>
                  </TableCell>
                )}
                <TableCell className="py-3 whitespace-normal tabular-nums">{itemSummary(s)}</TableCell>
                <TableCell className="py-3">
                  <ShipmentStatusLabel status={s.status} />
                  {s.openDiscrepancies > 0 && (
                    <p className="mt-1 text-[0.8125rem] text-warning">{s.openDiscrepancies} open discrepancy</p>
                  )}
                </TableCell>
                <TableCell className="py-3 whitespace-nowrap">
                  <ExpectedDate s={s} />
                </TableCell>
                <TableCell className="py-3 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">
                  {s.dispatchedAt ? formatDateTime(s.dispatchedAt) : "Not yet"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** Previous and next page links with the visible range. */
export function Pager({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  if (total <= pageSize) return null;
  const last = Math.ceil(total / pageSize);
  const link = "inline-flex min-h-10 items-center gap-1 rounded-md px-3 text-[0.9375rem] font-medium text-primary hover:bg-muted";
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      <p className="text-[0.875rem] text-muted-foreground tabular-nums">
        {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
      </p>
      <div className="flex gap-1">
        {page > 1 && (
          <Link href={hrefFor(page - 1)} className={link}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            Previous
          </Link>
        )}
        {page < last && (
          <Link href={hrefFor(page + 1)} className={link}>
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
    </nav>
  );
}

/**
 * The quantity trail of one request: what was asked for, approved, sent and received. Each
 * step that has not happened yet says so instead of showing zero.
 */
export function QuantityTrail({
  unit,
  requested,
  approved,
  dispatched,
  received,
  damaged,
}: {
  unit: string;
  requested: number;
  approved: number | null;
  dispatched: number | null;
  received: number | null;
  damaged: number | null;
}) {
  const shortage = dispatched !== null && received !== null ? dispatched - received - (damaged ?? 0) : null;
  const steps: Array<[string, number | null, string?]> = [
    ["Requested", requested],
    ["Approved", approved, approved === null ? "Awaiting decision" : undefined],
    ["Dispatched", dispatched, dispatched === null ? "Not yet" : undefined],
    ["Received in good condition", received, received === null ? "Not yet" : undefined],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {steps.map(([label, value, missing]) => (
          <div key={label} className="bg-card px-4 py-3">
            <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
            <dd className={cn("mt-1 text-xl font-semibold", value === null && "text-[0.9375rem] font-normal text-muted-foreground")}>
              {value === null ? missing : <Qty value={value} unit={unit} />}
            </dd>
          </div>
        ))}
      </dl>
      {shortage !== null && (shortage > 0 || (damaged ?? 0) > 0) && (
        <p className="text-[0.9375rem] text-warning tabular-nums">
          Discrepancy: {formatQuantity(shortage)} {unit} short, {formatQuantity(damaged ?? 0)} {unit} damaged. Neither was added
          to shop stock.
        </p>
      )}
    </div>
  );
}

/** A forecast is an estimate from recorded distributions; say so, and say when there is too little history. */
export function ForecastText({ forecast }: { forecast: Forecast }) {
  if (forecast.status === "insufficient") {
    return <p className="text-[0.9375rem] text-muted-foreground">No estimate yet. {forecast.basis}</p>;
  }
  return (
    <p className="text-[0.9375rem]">
      <span className="font-medium tabular-nums">
        {forecast.daysOfCover === 0
          ? "Less than a day of stock left at recent usage."
          : `About ${forecast.daysOfCover} ${forecast.daysOfCover === 1 ? "day" : "days"} of stock left.`}
      </span>{" "}
      <span className="text-muted-foreground">Estimate, not a guarantee. {forecast.basis}</span>
    </p>
  );
}

/**
 * Replenishment suggestions for commodities at or below their threshold. A suggestion only
 * pre-fills a request; the shop administrator submits it and the warehouse decides.
 */
export function SuggestionList({ items }: { items: ReplenishmentSuggestion[] }) {
  const low = items.filter((s) => s.onHand <= s.threshold);
  if (low.length === 0) return <EmptyState title="Nothing to request. Every commodity is above its low-stock threshold." />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {low.map((s) => (
        <li key={s.commodityCode} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {s.nameEn}
              <StockLevelLabel level={stockLevel(s.onHand, s.threshold)} />
            </p>
            <p className="text-[0.875rem] text-muted-foreground tabular-nums">
              {formatQuantity(s.onHand)} {s.unit} in stock, threshold {formatQuantity(s.threshold)} {s.unit}.{" "}
              {s.openRequest
                ? `${s.openRequest.reference} is ${s.openRequest.status === "approved" ? `approved for ${formatQuantity(s.openRequest.quantity)} ${s.unit}` : "waiting for a decision"}.`
                : `Suggested ${formatQuantity(s.suggestedQuantity)} ${s.unit} to reach the ${formatQuantity(s.target)} ${s.unit} target${s.targetIsDefault ? " (twice the threshold)" : ""}.`}
            </p>
            <p className="text-[0.8125rem] text-muted-foreground">
              Suggested priority: {priorityLabel[s.recommendation.priority]}. {s.recommendation.reason}
            </p>
          </div>
          {s.openRequest ? (
            <Link href={`/shop/requests/${s.openRequest.id}`} className="inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline">
              View {s.openRequest.reference}
            </Link>
          ) : (
            s.suggestedQuantity > 0 && (
              <Link
                href={`/shop/requests/new?commodity=${s.commodityCode}`}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-input bg-card px-4 text-[0.9375rem] font-medium transition-colors duration-150 hover:bg-muted"
              >
                Request {formatQuantity(s.suggestedQuantity)} {s.unit}
              </Link>
            )
          )}
        </li>
      ))}
    </ul>
  );
}

/** Items on a shipment with what was dispatched and, once confirmed, what arrived. */
export function ShipmentItems({ shipment, area }: { shipment: ShipmentDetail; area: "shop" | "warehouse" }) {
  const received = shipment.receivedAt !== null;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {/* Nothing counts as dispatched, or received, until that step is recorded. */}
      {shipment.detailItems.map((i) => {
        const shortage = i.receivedQuantity !== null ? i.quantity - i.receivedQuantity - (i.damagedQuantity ?? 0) : null;
        return (
          <li key={i.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-medium">
                {i.commodityName}{" "}
                <Link href={`/${area}/requests/${i.requestId}`} className="ml-1 font-mono text-[0.8125rem] font-normal text-primary underline-offset-4 hover:underline">
                  {i.requestReference}
                </Link>
              </p>
              {i.discrepancy && <DiscrepancyLabel status={i.discrepancy.status} />}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.875rem] sm:grid-cols-5">
              {(
                [
                  ["Requested", i.requestedQuantity],
                  ["Approved", i.approvedQuantity],
                  ["Dispatched", shipment.dispatchedAt ? i.quantity : null],
                  ["Received good", received ? i.receivedQuantity : null],
                  ["Damaged or short", received ? (i.damagedQuantity ?? 0) + (shortage ?? 0) : null],
                ] as Array<[string, number | null]>
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-[0.9375rem]">{value === null ? <span className="text-muted-foreground">Not yet</span> : <Qty value={value} unit={i.unit} />}</dd>
                </div>
              ))}
            </dl>
            {i.discrepancy && (
              <p className="text-[0.875rem] tabular-nums">
                {formatQuantity(i.discrepancy.shortageQuantity)} {i.unit} short, {formatQuantity(i.discrepancy.damagedQuantity)} {i.unit} damaged.
                {i.discrepancy.resolution && (
                  <span className="text-muted-foreground">
                    {" "}
                    Resolved{i.discrepancy.resolvedByName ? ` by ${i.discrepancy.resolvedByName}` : ""}
                    {i.discrepancy.resolvedAt ? `, ${formatDateTime(i.discrepancy.resolvedAt)}` : ""}: {i.discrepancy.resolution}
                  </span>
                )}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Each recorded step of a shipment, with who did it and when. */
export function ShipmentEvents({ shipment: s }: { shipment: ShipmentDetail }) {
  const events: Array<[string, string | null, string | null]> = [
    ["Prepared", s.createdAt, s.createdByName],
    ["Dispatched", s.dispatchedAt, s.dispatchedByName],
    ["In transit", s.inTransitAt, null],
    ["Disputed by the shop", s.disputedAt, s.disputeReason],
    ["Receipt confirmed", s.receivedAt, s.receivedByName],
    ["Cancelled", s.cancelledAt, s.cancelReason],
  ];
  return (
    <ol className="space-y-3">
      {events
        .filter(([, at]) => at)
        .map(([label, at, detail]) => (
          <li key={label} className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-3">
            <span aria-hidden="true" className="mt-2 size-2 rounded-full bg-primary" />
            <div>
              <p className="font-medium">{label}</p>
              <p className="text-[0.875rem] text-muted-foreground tabular-nums">
                {formatDateTime(at!)}
                {detail && ` · ${detail}`}
              </p>
            </div>
          </li>
        ))}
    </ol>
  );
}
