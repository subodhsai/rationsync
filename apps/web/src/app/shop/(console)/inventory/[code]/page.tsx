import { stockLevel } from "@rationsync/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MovementForm, ThresholdForm } from "@/components/inventory-forms";
import { MovementList } from "@/components/movement-list";
import { BackLink, PageSkeleton, Panel } from "@/components/page";
import { StockLevelLabel } from "@/components/status";
import { StockMeter } from "@/components/stock-meter";
import { getCommodities, getMovements, getShopInventory } from "@/lib/data";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { requireApprovedShop } from "@/lib/session";

export const metadata: Metadata = { title: "Commodity" };

export default function CommodityPage({ params }: PageProps<"/shop/inventory/[code]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Commodity params={params} />
    </Suspense>
  );
}

async function Commodity({ params }: Pick<PageProps<"/shop/inventory/[code]">, "params">) {
  const session = await requireApprovedShop();
  const { code } = await params;
  const [commodities, inventory, history] = await Promise.all([
    getCommodities(session),
    getShopInventory(session),
    getMovements(session, { commodity: code, limit: 20 }),
  ]);
  const commodity = commodities.find((c) => c.code === code);
  if (!commodity) notFound();
  const item = inventory.find((i) => i.commodityCode === code);

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/shop/inventory">Inventory</BackLink>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] sm:text-[1.75rem]">
            {commodity.nameEn}{" "}
            <span lang="kn" className="text-lg font-normal text-muted-foreground">
              {commodity.nameKn}
            </span>
          </h1>
          {item && <StockLevelLabel level={stockLevel(item.quantity, item.lowStockThreshold)} />}
        </div>
      </div>

      {item ? (
        <section aria-label="Stock on hand" className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <p className="text-[2rem] leading-none font-semibold tabular-nums">
              {formatQuantity(item.quantity)} <span className="font-mono text-lg font-normal text-muted-foreground">{item.unit}</span>
            </p>
            <p className="text-[0.9375rem] text-muted-foreground tabular-nums">
              Threshold {formatQuantity(item.lowStockThreshold)} {item.unit} · last movement {formatDateTime(item.updatedAt)}
            </p>
          </div>
          <StockMeter quantity={item.quantity} threshold={item.lowStockThreshold} className="h-2" />
        </section>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">This shop has not recorded any {commodity.nameEn.toLowerCase()} yet.</p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title={item ? "Record a movement" : "Record opening balance"}>
          <MovementForm commodity={commodity} stocked={Boolean(item)} />
        </Panel>
        {item && (
          <Panel title="Low-stock threshold">
            <ThresholdForm commodity={commodity} current={item.lowStockThreshold} />
          </Panel>
        )}
      </div>

      <section aria-labelledby="history" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="history" className="text-lg font-semibold">
            History
          </h2>
          {history.nextCursor && (
            <Link href={`/shop/movements?commodity=${code}`} className="text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline">
              Full history
            </Link>
          )}
        </div>
        <MovementList items={history.items} showCommodity={false} />
      </section>
    </>
  );
}
