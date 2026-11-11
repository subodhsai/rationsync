import { stockLevel } from "@rationsync/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink, PageSkeleton, Panel } from "@/components/page";
import { StockLevelLabel } from "@/components/status";
import { WarehouseMovementForm, WarehouseThresholdForm } from "@/components/supply-forms";
import { Qty } from "@/components/supply-lists";
import { StockBarLegend, WarehouseMovementList, WarehouseStockBar } from "@/components/warehouse-stock";
import { getCommodities, getMyWarehouses } from "@/lib/data";
import { requireRole } from "@/lib/session";
import { getWarehouseMovements, getWarehouseStock } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Warehouse commodity" };

export default function WarehouseCommodityPage({ params, searchParams }: PageProps<"/warehouse/inventory/[warehouseId]/[code]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Commodity params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Commodity({ params, searchParams }: Pick<PageProps<"/warehouse/inventory/[warehouseId]/[code]">, "params" | "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const [{ warehouseId, code }, query] = await Promise.all([params, searchParams]);
  const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);
  const [warehouses, commodities, stock] = await Promise.all([getMyWarehouses(session), getCommodities(session), getWarehouseStock(session)]);
  const warehouse = warehouses.find((w) => w.id === warehouseId);
  const commodity = commodities.find((c) => c.code === code);
  if (!warehouse || !commodity) notFound();
  const item = stock.find((s) => s.warehouseId === warehouseId && s.commodityCode === code);
  const ledger = await getWarehouseMovements(session, { warehouseId, commodity: code, page });
  const base = `/warehouse/inventory/${warehouseId}/${code}`;

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/warehouse/inventory">Warehouse stock</BackLink>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] sm:text-[1.75rem]">
            {commodity.nameEn}{" "}
            <span lang="kn" className="text-lg font-normal text-muted-foreground">
              {commodity.nameKn}
            </span>
          </h1>
          {item && <StockLevelLabel level={stockLevel(item.available, item.lowStockThreshold)} />}
        </div>
        <p className="text-[0.9375rem] text-muted-foreground">{warehouse.name}</p>
      </div>

      {item ? (
        <section aria-label="Stock" className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                ["Available to allocate", item.available],
                ["Reserved", item.reserved],
                ["On hand", item.onHand],
                ["In transit to shops", item.inTransit],
              ] as const
            ).map(([label, value], i) => (
              <div key={label}>
                <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
                <dd className={i === 0 ? "mt-1 text-[1.75rem] leading-none font-semibold" : "mt-1 text-lg"}>
                  <Qty value={value} unit={item.unit} />
                </dd>
              </div>
            ))}
          </dl>
          <WarehouseStockBar item={item} className="h-2.5" />
          <StockBarLegend />
        </section>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">No {commodity.nameEn.toLowerCase()} recorded at this warehouse yet.</p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title={item ? "Record a receipt or adjustment" : "Record opening balance"}>
          <WarehouseMovementForm warehouseId={warehouseId} commodity={commodity} stocked={Boolean(item)} />
        </Panel>
        {item && (
          <Panel title="Low-stock threshold">
            <WarehouseThresholdForm warehouseId={warehouseId} commodity={commodity} current={item.lowStockThreshold} />
          </Panel>
        )}
      </div>

      <section aria-labelledby="history" className="space-y-3">
        <h2 id="history" className="text-lg font-semibold">
          Movements and receiving history
        </h2>
        <WarehouseMovementList items={ledger.items} />
        {(ledger.page > 1 || ledger.hasMore) && (
          <nav aria-label="Pages" className="flex justify-end gap-3 text-[0.9375rem] font-medium">
            {ledger.page > 1 && (
              <Link href={`${base}?page=${ledger.page - 1}`} className="inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline">
                Newer
              </Link>
            )}
            {ledger.hasMore && (
              <Link href={`${base}?page=${ledger.page + 1}`} className="inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline">
                Older
              </Link>
            )}
          </nav>
        )}
      </section>
    </>
  );
}
