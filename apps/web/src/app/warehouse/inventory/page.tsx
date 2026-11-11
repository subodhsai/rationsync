import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton, SectionHeading } from "@/components/page";
import { StockBarLegend, WarehouseMovementList, WarehouseStockTable } from "@/components/warehouse-stock";
import { getCommodities, getMyWarehouses } from "@/lib/data";
import { requireRole } from "@/lib/session";
import { getWarehouseMovements, getWarehouseStock } from "@/lib/supply-data";
import Link from "next/link";

export const metadata: Metadata = { title: "Warehouse stock" };

export default function WarehouseInventoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Inventory />
    </Suspense>
  );
}

async function Inventory() {
  const session = await requireRole("warehouse_admin");
  const [stock, warehouses, movements, commodities] = await Promise.all([
    getWarehouseStock(session),
    getMyWarehouses(session),
    getWarehouseMovements(session, {}),
    getCommodities(session),
  ]);
  // Commodities a warehouse has never recorded, so their opening balance can be entered.
  const missing = warehouses.flatMap((w) =>
    commodities.filter((c) => !stock.some((s) => s.warehouseId === w.id && s.commodityCode === c.code)).map((c) => ({ w, c })),
  );

  return (
    <>
      <PageHeader title="Warehouse stock" meta="Kept separately from shop stock. Reserved stock is held for approved requests until it is dispatched." />
      <section aria-label="Stock by commodity" className="space-y-3">
        <WarehouseStockTable items={stock} showWarehouse={warehouses.length > 1} />
        <StockBarLegend />
        {missing.length > 0 && (
          <p className="text-[0.9375rem] text-muted-foreground">
            No stock recorded for{" "}
            {missing.map(({ w, c }, i) => (
              <span key={`${w.id}-${c.code}`}>
                {i > 0 && ", "}
                <Link href={`/warehouse/inventory/${w.id}/${c.code}`} className="text-primary underline-offset-4 hover:underline">
                  {c.nameEn}
                  {warehouses.length > 1 && ` at ${w.name}`}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
      </section>
      <section aria-labelledby="ledger" className="space-y-3">
        <SectionHeading id="ledger" title="Recent movements and receipts" />
        <WarehouseMovementList items={movements.items.slice(0, 10)} />
      </section>
    </>
  );
}
