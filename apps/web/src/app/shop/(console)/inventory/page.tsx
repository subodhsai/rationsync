import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { InventoryTable, StockRuleNote } from "@/components/inventory-table";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { getCommodities, getShopInventory } from "@/lib/data";
import { requireApprovedShop } from "@/lib/session";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Inventory />
    </Suspense>
  );
}

async function Inventory() {
  const session = await requireApprovedShop();
  const [items, commodities] = await Promise.all([getShopInventory(session), getCommodities(session)]);
  const notStocked = commodities.filter((c) => !items.some((i) => i.commodityCode === c.code));

  return (
    <>
      <PageHeader title="Inventory" meta={`Stock on hand at ${session.me.shop.name}. Open a commodity to record a movement.`} />
      {items.length === 0 ? (
        <EmptyState title="No stock recorded yet">Choose a commodity below and record its opening balance.</EmptyState>
      ) : (
        <div className="space-y-3">
          <InventoryTable items={items} hrefFor={(i) => `/shop/inventory/${i.commodityCode}`} />
          <StockRuleNote />
        </div>
      )}

      {notStocked.length > 0 && (
        <section aria-labelledby="not-stocked" className="space-y-3">
          <h2 id="not-stocked" className="text-lg font-semibold">
            Not stocked yet
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {notStocked.map((c) => (
              <li key={c.code}>
                <Link
                  href={`/shop/inventory/${c.code}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 transition-colors duration-150 hover:bg-muted/50"
                >
                  <span>
                    <span className="font-medium">{c.nameEn}</span>{" "}
                    <span lang="kn" className="text-[0.875rem] text-muted-foreground">
                      {c.nameKn}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-[0.9375rem] text-primary">
                    Record opening balance
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
