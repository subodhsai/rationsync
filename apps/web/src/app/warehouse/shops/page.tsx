import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { parseShopFilters, ShopFilters, ShopTable } from "@/components/shop-table";
import { getMyWarehouses, getShopRegistrations } from "@/lib/data";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Shop directory" };

export default function ShopDirectoryPage({ searchParams }: PageProps<"/warehouse/shops">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Directory searchParams={searchParams} />
    </Suspense>
  );
}

async function Directory({ searchParams }: Pick<PageProps<"/warehouse/shops">, "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const warehouses = await getMyWarehouses(session);
  const filters = parseShopFilters(await searchParams, warehouses, "approved");
  const rows = await getShopRegistrations(session, filters);

  return (
    <>
      <PageHeader title="Shop directory" meta="Approved shops supplied by your warehouses, with their open low-stock alerts." />
      <div className="space-y-4">
        <ShopFilters action="/warehouse/shops" filters={filters} warehouses={warehouses} />
        <ShopTable rows={rows} emptyTitle="No approved shops match these filters." variant="directory" />
      </div>
    </>
  );
}
