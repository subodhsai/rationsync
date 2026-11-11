import { stockLevel } from "@rationsync/shared";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertList } from "@/components/alert-list";
import { MovementList } from "@/components/movement-list";
import { PageHeader, PageSkeleton, SectionHeading, StatRow } from "@/components/page";
import { ShopStatusLabel } from "@/components/status";
import { ShipmentTable, SuggestionList } from "@/components/supply-lists";
import { getMovements, getShopAlerts, getShopInventory } from "@/lib/data";
import { requireApprovedShop } from "@/lib/session";
import { getNotifications, getShopRequests, getShopShipments, getSuggestions } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Shop overview" };

export default function ShopOverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const session = await requireApprovedShop();
  const [items, alerts, recent, suggestions, openRequests, incoming, notifications] = await Promise.all([
    getShopInventory(session),
    getShopAlerts(session, "open"),
    getMovements(session, { limit: 5 }),
    getSuggestions(session),
    getShopRequests(session, "open"),
    getShopShipments(session, "incoming"),
    getNotifications(session),
  ]);
  const levels = items.map((i) => stockLevel(i.quantity, i.lowStockThreshold));

  return (
    <>
      <PageHeader
        title={session.me.shop.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-[0.875rem]">{session.me.shop.fpsId}</span>
            <ShopStatusLabel status={session.me.shop.status} />
          </span>
        }
      />

      <StatRow
        stats={[
          { label: "Low or out of stock", value: levels.filter((l) => l !== "ok").length, href: "/shop/alerts", attention: true },
          { label: "Open requests", value: openRequests.length, href: "/shop/requests" },
          { label: "Shipments on the way", value: incoming.length, href: "/shop/shipments", attention: true },
          { label: "Unread notifications", value: notifications.unread, href: "/shop/notifications" },
        ]}
      />

      {incoming.length > 0 && (
        <section aria-labelledby="incoming" className="space-y-3">
          <SectionHeading id="incoming" title="On the way to you" href="/shop/shipments" linkLabel="All shipments" />
          <ShipmentTable rows={incoming} area="shop" emptyTitle="" />
        </section>
      )}

      <section aria-labelledby="restock" className="space-y-3">
        <SectionHeading id="restock" title="Restock" href="/shop/requests/new" linkLabel="New request" />
        <SuggestionList items={suggestions} />
      </section>

      <section aria-labelledby="attention" className="space-y-3">
        <SectionHeading id="attention" title="Low-stock alerts" href="/shop/alerts" linkLabel="All alerts" />
        <AlertList
          items={alerts}
          showShop={false}
          linkTo={(a) => `/shop/inventory/${a.commodityCode}`}
          emptyTitle="Every commodity is above its low-stock threshold."
        />
      </section>

      <section aria-labelledby="recent" className="space-y-3">
        <SectionHeading id="recent" title="Recent stock movements" href="/shop/movements" linkLabel="Full ledger" />
        <MovementList items={recent.items} />
      </section>
    </>
  );
}
