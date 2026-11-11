import type { ReplenishmentRequest } from "@rationsync/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BackLink, EmptyState, PageHeader, PageSkeleton, Panel } from "@/components/page";
import { CreateShipmentForm } from "@/components/supply-forms";
import { formatQuantity } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { getWarehouseRequests } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Prepare shipment" };

export default function NewShipmentPage({ searchParams }: PageProps<"/warehouse/shipments/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewShipment searchParams={searchParams} />
    </Suspense>
  );
}

const tomorrowIst = () => new Date(Date.now() + (5.5 + 24) * 3600_000).toISOString().slice(0, 10);

async function NewShipment({ searchParams }: Pick<PageProps<"/warehouse/shipments/new">, "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const params = await searchParams;
  // Approved requests not yet on a shipment, grouped by destination shop.
  // ponytail: reads the first page of approved requests (25); page through if a warehouse ever has more waiting.
  const approved = (await getWarehouseRequests(session, { status: "approved", sort: "oldest", page: 1 })).items.filter((r) => !r.shipment);
  const byShop = new Map<string, ReplenishmentRequest[]>();
  for (const r of approved) byShop.set(r.shopId, [...(byShop.get(r.shopId) ?? []), r]);
  const shopId = typeof params.shopId === "string" && byShop.has(params.shopId) ? params.shopId : byShop.size === 1 ? [...byShop.keys()][0] : undefined;
  const selected = shopId ? byShop.get(shopId)! : null;

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/warehouse/shipments">Shipments</BackLink>
        <PageHeader title="Prepare shipment" meta="One shipment carries approved requests for one shop." />
      </div>

      {byShop.size === 0 ? (
        <EmptyState title="No approved requests are waiting for dispatch">Approve a request first; its stock is reserved until it ships.</EmptyState>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav aria-label="Shops with approved requests" className="rounded-lg border border-border bg-card p-1">
            <ul className="space-y-0.5">
              {[...byShop.entries()].map(([id, rows]) => (
                <li key={id}>
                  <Link
                    href={`/warehouse/shipments/new?shopId=${id}`}
                    aria-current={id === shopId ? "page" : undefined}
                    className={`block rounded-md px-3 py-2.5 transition-colors duration-150 ${id === shopId ? "bg-primary-tint text-primary" : "hover:bg-muted"}`}
                  >
                    <span className="block font-medium">{rows[0]!.shopName}</span>
                    <span className="block text-[0.8125rem] text-muted-foreground tabular-nums">
                      {rows.map((r) => `${r.commodityName} ${formatQuantity(r.approvedQuantity ?? 0)} ${r.unit}`).join(", ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {selected ? (
            <Panel title={`To ${selected[0]!.shopName}`} description={<span className="font-mono text-[0.875rem]">{selected[0]!.fpsId}</span>}>
              <CreateShipmentForm key={shopId} shopId={shopId!} requests={selected} defaultDate={tomorrowIst()} />
            </Panel>
          ) : (
            <EmptyState title="Choose a shop">Pick the destination from the list.</EmptyState>
          )}
        </div>
      )}
    </>
  );
}
