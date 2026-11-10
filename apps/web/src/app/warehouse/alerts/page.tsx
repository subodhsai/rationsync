import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertList, AlertRuleNote } from "@/components/alert-list";
import { FilterTabs } from "@/components/filter-tabs";
import { PageHeader, PageSkeleton } from "@/components/page";
import { getWarehouseAlerts } from "@/lib/data";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Low stock" };

export default function WarehouseAlertsPage({ searchParams }: PageProps<"/warehouse/alerts">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Alerts searchParams={searchParams} />
    </Suspense>
  );
}

async function Alerts({ searchParams }: Pick<PageProps<"/warehouse/alerts">, "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const status = (await searchParams).status === "resolved" ? "resolved" : "open";
  const alerts = await getWarehouseAlerts(session, status);
  const shops = new Set(alerts.map((a) => a.shopId)).size;

  return (
    <>
      <PageHeader title="Low stock" meta="Alerts from the shops your warehouses supply, most urgent first." />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterTabs
            label="Alert status"
            options={[
              { href: "/warehouse/alerts", label: "Open", current: status === "open" },
              { href: "/warehouse/alerts?status=resolved", label: "Resolved", current: status === "resolved" },
            ]}
          />
          {status === "open" && alerts.length > 0 && (
            <p className="text-[0.9375rem] text-muted-foreground tabular-nums">
              {alerts.length} {alerts.length === 1 ? "alert" : "alerts"} across {shops} {shops === 1 ? "shop" : "shops"}
            </p>
          )}
        </div>
        <AlertList
          items={alerts}
          showShop
          linkTo={(a) => `/warehouse/shops/${a.shopId}`}
          emptyTitle={status === "open" ? "No shop is at or below a threshold." : "No resolved alerts yet."}
        />
        <AlertRuleNote />
      </div>
    </>
  );
}
