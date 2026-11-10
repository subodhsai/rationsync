import { stockLevel } from "@rationsync/shared";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { ShopStatusLabel, StockLevelLabel } from "@/components/status";
import { getShopInventory } from "@/lib/data";
import { formatQuantity } from "@/lib/format";
import { requireApprovedShop } from "@/lib/session";

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
  const items = await getShopInventory(session);
  const withLevel = items.map((item) => ({ ...item, level: stockLevel(item.quantity, item.lowStockThreshold) }));
  const attention = withLevel
    .filter((item) => item.level !== "ok")
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "out" ? -1 : 1));

  const stats = [
    { label: "Commodities tracked", value: items.length },
    { label: "Low stock", value: withLevel.filter((i) => i.level === "low").length },
    { label: "Out of stock", value: withLevel.filter((i) => i.level === "out").length },
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
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="attention" className="text-lg font-semibold">
            Needs attention
          </h2>
          <Link
            href="/shop/inventory"
            className="inline-flex min-h-11 items-center gap-1 text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline"
          >
            Full inventory
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {attention.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-5 text-[0.9375rem] text-muted-foreground">
            Every commodity is above its low-stock threshold.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {attention.map((item) => (
              <li key={item.commodityCode} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{item.nameEn}</p>
                  <p className="text-[0.875rem] text-muted-foreground tabular-nums">
                    {formatQuantity(item.quantity)} {item.unit} left, threshold {formatQuantity(item.lowStockThreshold)}{" "}
                    {item.unit}
                  </p>
                </div>
                <StockLevelLabel level={item.level} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
