import { FORECAST_WINDOW_DAYS } from "@rationsync/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { DiscrepancyLabel, ShipmentStatusLabel } from "@/components/status";
import { Qty } from "@/components/supply-lists";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/session";
import { getAnalytics, getReconciliation } from "@/lib/supply-data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Stock analytics" };

export default function AnalyticsPage({ searchParams }: PageProps<"/warehouse/analytics">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Analytics searchParams={searchParams} />
    </Suspense>
  );
}

const dash = <span className="text-muted-foreground">Not yet</span>;

async function Analytics({ searchParams }: Pick<PageProps<"/warehouse/analytics">, "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const onlyDiscrepancies = (await searchParams).view === "discrepancies";
  const [commodities, reconciliation] = await Promise.all([
    getAnalytics(session),
    getReconciliation(session, onlyDiscrepancies ? "discrepancies" : "all"),
  ]);

  return (
    <>
      <PageHeader title="Stock analytics" meta="Worked out from recorded stock, shipments and distributions in your region." />

      <section aria-labelledby="supply" className="space-y-3">
        <h2 id="supply" className="text-lg font-semibold">
          Supply by commodity
        </h2>
        {commodities.length === 0 ? (
          <EmptyState title="No stock recorded yet" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {commodities.map((c) => (
              <li key={c.commodityCode} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.2fr)]">
                <p className="text-lg font-semibold">{c.nameEn}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.875rem] sm:grid-cols-4 lg:grid-cols-2">
                  {(
                    [
                      ["Warehouse available", c.warehouseAvailable],
                      ["Reserved", c.warehouseReserved],
                      ["In transit", c.inTransit],
                      ["At shops", c.shopStock],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 text-[0.9375rem]">
                        <Qty value={value} unit={c.unit} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="space-y-1 text-[0.9375rem]">
                  <p className="tabular-nums">
                    {c.shopsStocking === 0 ? (
                      <span className="text-muted-foreground">No shop stocks {c.nameEn.toLowerCase()} yet</span>
                    ) : (
                      <>
                        <span className={cn(c.shopsLow > 0 && "font-medium text-warning")}>
                          {c.shopsLow} of {c.shopsStocking} {c.shopsStocking === 1 ? "shop" : "shops"}
                        </span>{" "}
                        at or below threshold
                      </>
                    )}
                  </p>
                  {c.forecast.status === "estimate" ? (
                    <p>
                      <span className="font-medium tabular-nums">About {c.forecast.daysOfCover} days of supply</span> across warehouse,
                      transit and shops.{" "}
                      <span className="text-muted-foreground">Estimate, not a guarantee. {c.forecast.basis}</span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">No estimate yet. {c.forecast.basis}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[0.8125rem] text-muted-foreground">
          Days of supply = all stock in the region divided by the average daily distribution over the last {FORECAST_WINDOW_DAYS} days
          (or fewer, if the ledger is younger). It assumes recent usage continues.
        </p>
      </section>

      <section id="reconciliation" aria-labelledby="reconciliation-heading" className="scroll-mt-6 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="reconciliation-heading" className="text-lg font-semibold">
            Delivery reconciliation
          </h2>
          <nav aria-label="Reconciliation view" className="flex gap-3 text-[0.9375rem]">
            <Link href="/warehouse/analytics#reconciliation" aria-current={!onlyDiscrepancies ? "page" : undefined} className={cn("min-h-10 content-center underline-offset-4 hover:underline", !onlyDiscrepancies ? "font-medium text-primary" : "text-muted-foreground")}>
              All approved
            </Link>
            <Link href="/warehouse/analytics?view=discrepancies#reconciliation" aria-current={onlyDiscrepancies ? "page" : undefined} className={cn("min-h-10 content-center underline-offset-4 hover:underline", onlyDiscrepancies ? "font-medium text-primary" : "text-muted-foreground")}>
              With discrepancies
            </Link>
          </nav>
        </div>
        {reconciliation.length === 0 ? (
          <EmptyState title={onlyDiscrepancies ? "No discrepancies recorded." : "No approved requests yet."} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table className="min-w-[56rem] text-[0.9375rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 pl-4">Request</TableHead>
                  <TableHead>Shop and commodity</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Dispatched</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Damaged</TableHead>
                  <TableHead className="text-right">Short</TableHead>
                  <TableHead className="pr-4">Shipment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconciliation.map((r) => (
                  <TableRow key={r.requestId} className="align-top">
                    <TableCell className="py-3 pl-4">
                      <Link href={`/warehouse/requests/${r.requestId}`} className="font-mono text-[0.875rem] font-medium text-primary underline-offset-4 hover:underline">
                        {r.requestReference}
                      </Link>
                    </TableCell>
                    <TableCell className="py-3">
                      <p>{r.shopName}</p>
                      <p className="text-[0.8125rem] text-muted-foreground">{r.commodityName}</p>
                    </TableCell>
                    <TableCell className="py-3 text-right"><Qty value={r.requested} unit={r.unit} /></TableCell>
                    <TableCell className="py-3 text-right"><Qty value={r.approved} unit={r.unit} /></TableCell>
                    <TableCell className="py-3 text-right">{r.dispatched === null ? dash : <Qty value={r.dispatched} unit={r.unit} />}</TableCell>
                    <TableCell className="py-3 text-right">{r.received === null ? dash : <Qty value={r.received} unit={r.unit} />}</TableCell>
                    <TableCell className={cn("py-3 text-right", (r.damaged ?? 0) > 0 && "text-warning")}>{r.damaged === null ? dash : <Qty value={r.damaged} unit={r.unit} />}</TableCell>
                    <TableCell className={cn("py-3 text-right", (r.shortage ?? 0) > 0 && "text-warning")}>{r.shortage === null ? dash : <Qty value={r.shortage} unit={r.unit} />}</TableCell>
                    <TableCell className="space-y-1 py-3 pr-4">
                      {r.shipmentId ? (
                        <>
                          <Link href={`/warehouse/shipments/${r.shipmentId}`} className="block font-mono text-[0.875rem] text-primary underline-offset-4 hover:underline">
                            {r.shipmentReference}
                          </Link>
                          <ShipmentStatusLabel status={r.shipmentStatus!} />
                          {r.discrepancyStatus && <div><DiscrepancyLabel status={r.discrepancyStatus} /></div>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not on a shipment</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-[0.8125rem] text-muted-foreground">
          Short = dispatched minus received minus damaged. Only received quantities are added to shop stock; open discrepancies are
          settled on the shipment page.
        </p>
      </section>
    </>
  );
}
