import type { ShopStatus } from "@rationsync/shared";
import type { Metadata } from "next";
import { Suspense } from "react";
import { FilterTabs } from "@/components/filter-tabs";
import { PageHeader, PageSkeleton } from "@/components/page";
import { parseShopFilters, ShopFilters, ShopTable } from "@/components/shop-table";
import { getMyWarehouses, getShopRegistrations } from "@/lib/data";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Applications" };

const tabs: Array<{ status: ShopStatus; label: string; empty: string }> = [
  { status: "pending", label: "Pending", empty: "No applications are waiting for review." },
  { status: "approved", label: "Approved", empty: "No approved applications match these filters." },
  { status: "rejected", label: "Rejected", empty: "No rejected applications match these filters." },
];

export default function ApplicationsPage({ searchParams }: PageProps<"/warehouse">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Applications searchParams={searchParams} />
    </Suspense>
  );
}

async function Applications({ searchParams }: Pick<PageProps<"/warehouse">, "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const params = await searchParams;
  const tab = tabs.find((t) => t.status === params.status) ?? tabs[0]!;
  const warehouses = await getMyWarehouses(session);
  const filters = parseShopFilters(params, warehouses, tab.status);
  const rows = await getShopRegistrations(session, filters);

  const tabHref = (status: ShopStatus) => {
    const query = new URLSearchParams({
      ...(status !== "pending" ? { status } : {}),
      ...(filters.district ? { district: filters.district } : {}),
      ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
    });
    return `/warehouse${query.size ? `?${query}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Applications"
        meta="Shops asking to join RationSync through your warehouses. Open one to review and decide."
      />
      <div className="space-y-4">
        <FilterTabs
          label="Application status"
          options={tabs.map((t) => ({ href: tabHref(t.status), label: t.label, current: t.status === tab.status }))}
        />
        <ShopFilters
          action="/warehouse"
          filters={filters}
          warehouses={warehouses}
          keep={tab.status !== "pending" ? { status: tab.status } : {}}
        />
        <ShopTable rows={rows} emptyTitle={tab.empty} variant="applications" />
      </div>
    </>
  );
}
