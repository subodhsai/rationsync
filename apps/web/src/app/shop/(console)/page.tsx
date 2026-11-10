import { stockLevel } from "@rationsync/shared";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertList } from "@/components/alert-list";
import { MovementList } from "@/components/movement-list";
import { PageHeader, PageSkeleton } from "@/components/page";
import { ShopStatusLabel } from "@/components/status";
import { getMovements, getShopAlerts, getShopInventory } from "@/lib/data";
import { requireApprovedShop } from "@/lib/session";

export const metadata: Metadata = { title: "Shop overview" };

export default function ShopOverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

function SectionHeading({ id, title, href, linkLabel }: { id: string; title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <Link
        href={href}
        className="inline-flex min-h-11 items-center gap-1 text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline"
      >
        {linkLabel}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

async function Overview() {
  const session = await requireApprovedShop();
  const [items, alerts, recent] = await Promise.all([
    getShopInventory(session),
    getShopAlerts(session, "open"),
    getMovements(session, { limit: 5 }),
  ]);
  const levels = items.map((i) => stockLevel(i.quantity, i.lowStockThreshold));
  const stats = [
    { label: "Commodities tracked", value: items.length },
    { label: "Low stock", value: levels.filter((l) => l === "low").length },
    { label: "Out of stock", value: levels.filter((l) => l === "out").length },
  ];

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

      <dl className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-card">
        {stats.map((stat) => (
          <div key={stat.label} className="px-4 py-4 sm:px-5">
            <dt className="text-[0.8125rem] text-muted-foreground sm:text-[0.875rem]">{stat.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="attention" className="space-y-3">
        <SectionHeading id="attention" title="Needs attention" href="/shop/alerts" linkLabel="All alerts" />
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
