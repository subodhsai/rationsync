import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertList, AlertRuleNote } from "@/components/alert-list";
import { FilterTabs } from "@/components/filter-tabs";
import { PageHeader, PageSkeleton } from "@/components/page";
import { getShopAlerts } from "@/lib/data";
import { requireApprovedShop } from "@/lib/session";

export const metadata: Metadata = { title: "Low-stock alerts" };

export default function ShopAlertsPage({ searchParams }: PageProps<"/shop/alerts">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Alerts searchParams={searchParams} />
    </Suspense>
  );
}

async function Alerts({ searchParams }: Pick<PageProps<"/shop/alerts">, "searchParams">) {
  const session = await requireApprovedShop();
  const status = (await searchParams).status === "resolved" ? "resolved" : "open";
  const alerts = await getShopAlerts(session, status);

  return (
    <>
      <PageHeader title="Low-stock alerts" meta="Raised from this shop's thresholds. Open a row to record stock or change the threshold." />
      <div className="space-y-4">
        <FilterTabs
          label="Alert status"
          options={[
            { href: "/shop/alerts", label: "Open", current: status === "open" },
            { href: "/shop/alerts?status=resolved", label: "Resolved", current: status === "resolved" },
          ]}
        />
        <AlertList
          items={alerts}
          showShop={false}
          linkTo={(a) => `/shop/inventory/${a.commodityCode}`}
          emptyTitle={status === "open" ? "No open alerts. Every commodity is above its threshold." : "No resolved alerts yet."}
        />
        <AlertRuleNote />
      </div>
    </>
  );
}
