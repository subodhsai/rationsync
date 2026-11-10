import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryTable, StockRuleNote } from "@/components/inventory-table";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { getShopInventory } from "@/lib/data";
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
  const items = await getShopInventory(session);

  return (
    <>
      <PageHeader title="Inventory" meta={`Stock on hand at ${session.me.shop.name}`} />
      {items.length === 0 ? (
        <EmptyState title="No stock recorded yet">
          Opening balances and deliveries appear here once they are recorded.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <InventoryTable items={items} />
          <StockRuleNote />
        </div>
      )}
    </>
  );
}
