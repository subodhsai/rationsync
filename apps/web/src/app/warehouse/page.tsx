import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton, SectionHeading, StatRow } from "@/components/page";
import { RequestTable, ShipmentTable } from "@/components/supply-lists";
import { StockBarLegend, WarehouseStockTable } from "@/components/warehouse-stock";
import { getMyWarehouses } from "@/lib/data";
import { requireRole } from "@/lib/session";
import { getWarehouseOverview, getWarehouseStock } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Warehouse overview" };

export default function WarehouseOverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const session = await requireRole("warehouse_admin");
  const [{ metrics: m, requests, shipments }, stock, warehouses] = await Promise.all([
    getWarehouseOverview(session),
    getWarehouseStock(session),
    getMyWarehouses(session),
  ]);

  return (
    <>
      <PageHeader title="Overview" meta={warehouses.map((w) => w.name).join(", ")} />

      <StatRow
        stats={[
          {
            label: "Requests to decide",
            value: m.pendingRequests,
            href: "/warehouse/requests",
            note: m.urgentRequests ? `${m.urgentRequests} recommended urgent` : undefined,
            attention: true,
          },
          { label: "Active shipments", value: m.activeShipments, href: "/warehouse/shipments" },
          {
            label: "Awaiting receipt",
            value: m.awaitingReceipt,
            href: "/warehouse/shipments?status=awaiting_receipt",
            note: m.overdueShipments ? `${m.overdueShipments} past expected date` : undefined,
          },
          { label: "Shops with low stock", value: m.lowStockShops, href: "/warehouse/alerts", attention: true },
          { label: "Open discrepancies", value: m.openDiscrepancies, href: "/warehouse/analytics#reconciliation", attention: true },
          { label: "Warehouse commodities low", value: m.lowWarehouseStock, href: "/warehouse/inventory", attention: true },
        ]}
      />

      <section aria-labelledby="decide" className="space-y-3">
        <SectionHeading id="decide" title="Requests to decide" href="/warehouse/requests" linkLabel="All requests" />
        <RequestTable rows={requests} variant="warehouse" emptyTitle="No requests are waiting for a decision." />
        {requests.length > 0 && (
          <p className="text-[0.8125rem] text-muted-foreground">
            Ordered by the priority recommended from each shop&apos;s current stock and recent usage, then oldest first.
          </p>
        )}
      </section>

      <section aria-labelledby="awaiting" className="space-y-3">
        <SectionHeading id="awaiting" title="Awaiting receipt" href="/warehouse/shipments?status=awaiting_receipt" linkLabel="All shipments" />
        <ShipmentTable rows={shipments} area="warehouse" emptyTitle="No shipments are waiting for a shop to confirm receipt." />
      </section>

      <section aria-labelledby="stock" className="space-y-3">
        <SectionHeading id="stock" title="Warehouse stock" href="/warehouse/inventory" linkLabel="Stock and ledger" />
        <WarehouseStockTable items={stock} showWarehouse={warehouses.length > 1} />
        <StockBarLegend />
      </section>
    </>
  );
}
