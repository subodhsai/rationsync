import type { Metadata } from "next";
import { Suspense } from "react";
import { FilterTabs } from "@/components/filter-tabs";
import { PageHeader, PageSkeleton } from "@/components/page";
import { ShipmentTable } from "@/components/supply-lists";
import { requireApprovedShop } from "@/lib/session";
import { getShopShipments, type ShopShipmentTab } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Incoming shipments" };

const tabs: Array<{ value: ShopShipmentTab; label: string; empty: string }> = [
  { value: "incoming", label: "On the way", empty: "Nothing is on its way to your shop." },
  { value: "received", label: "Received", empty: "No deliveries confirmed yet." },
  { value: "all", label: "All", empty: "No shipments yet." },
];

export default function ShopShipmentsPage({ searchParams }: PageProps<"/shop/shipments">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Shipments searchParams={searchParams} />
    </Suspense>
  );
}

async function Shipments({ searchParams }: Pick<PageProps<"/shop/shipments">, "searchParams">) {
  const session = await requireApprovedShop();
  const { status } = await searchParams;
  const tab = tabs.find((t) => t.value === status) ?? tabs[0]!;
  const rows = await getShopShipments(session, tab.value);

  return (
    <>
      <PageHeader
        title="Incoming shipments"
        meta="Stock dispatched by your warehouse. Open one when it arrives to confirm the quantities."
      />
      <div className="space-y-4">
        <FilterTabs
          label="Shipment status"
          options={tabs.map((t) => ({
            href: t.value === "incoming" ? "/shop/shipments" : `/shop/shipments?status=${t.value}`,
            label: t.label,
            current: t === tab,
          }))}
        />
        <ShipmentTable rows={rows} area="shop" emptyTitle={tab.empty} />
      </div>
    </>
  );
}
