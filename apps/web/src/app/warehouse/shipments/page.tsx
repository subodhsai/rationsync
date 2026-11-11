import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterTabs } from "@/components/filter-tabs";
import { PageHeader, PageSkeleton } from "@/components/page";
import { Pager, ShipmentTable } from "@/components/supply-lists";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/session";
import { getWarehouseShipments, type ShipmentTab } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Shipments" };

const tabs: Array<{ value: ShipmentTab; label: string; empty: string }> = [
  { value: "active", label: "Active", empty: "No shipments are being prepared or on the road." },
  { value: "awaiting_receipt", label: "Awaiting receipt", empty: "No shipments are waiting for a shop to confirm receipt." },
  { value: "closed", label: "Delivery history", empty: "No completed or cancelled shipments yet." },
  { value: "all", label: "All", empty: "No shipments yet." },
];

const href = (status: ShipmentTab, page = 1) => {
  const q = new URLSearchParams({ ...(status !== "active" ? { status } : {}), ...(page > 1 ? { page: String(page) } : {}) });
  return `/warehouse/shipments${q.size ? `?${q}` : ""}`;
};

export default function WarehouseShipmentsPage({ searchParams }: PageProps<"/warehouse/shipments">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Shipments searchParams={searchParams} />
    </Suspense>
  );
}

async function Shipments({ searchParams }: Pick<PageProps<"/warehouse/shipments">, "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const params = await searchParams;
  const tab = tabs.find((t) => t.value === params.status) ?? tabs[0]!;
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const result = await getWarehouseShipments(session, { status: tab.value, page });

  return (
    <>
      <PageHeader title="Shipments" meta="Approved stock on its way to shops, tracked inside RationSync. No delivery partner is connected.">
        <Link href="/warehouse/shipments/new" className={buttonVariants({ size: "lg" })}>
          Prepare shipment
        </Link>
      </PageHeader>
      <div className="space-y-4">
        <FilterTabs label="Shipment status" options={tabs.map((t) => ({ href: href(t.value), label: t.label, current: t === tab }))} />
        <ShipmentTable rows={result.items} area="warehouse" emptyTitle={tab.empty} />
        <Pager page={result.page} total={result.total} pageSize={result.pageSize} hrefFor={(p) => href(tab.value, p)} />
      </div>
    </>
  );
}
