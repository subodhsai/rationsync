import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterTabs } from "@/components/filter-tabs";
import { PageHeader, PageSkeleton } from "@/components/page";
import { RequestTable } from "@/components/supply-lists";
import { buttonVariants } from "@/components/ui/button";
import { requireApprovedShop } from "@/lib/session";
import { getShopRequests, type ShopRequestTab } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Requests" };

const tabs: Array<{ value: ShopRequestTab; label: string; empty: string }> = [
  { value: "open", label: "Open", empty: "No open requests." },
  { value: "closed", label: "Closed", empty: "No closed requests yet." },
  { value: "all", label: "All", empty: "No requests yet." },
];

export default function ShopRequestsPage({ searchParams }: PageProps<"/shop/requests">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

async function Requests({ searchParams }: Pick<PageProps<"/shop/requests">, "searchParams">) {
  const session = await requireApprovedShop();
  const { status } = await searchParams;
  const tab = tabs.find((t) => t.value === status) ?? tabs[0]!;
  const rows = await getShopRequests(session, tab.value);

  return (
    <>
      <PageHeader title="Replenishment requests" meta="Ask your warehouse for more stock. A warehouse administrator reviews each request.">
        <Link href="/shop/requests/new" className={buttonVariants({ size: "lg" })}>
          New request
        </Link>
      </PageHeader>
      <div className="space-y-4">
        <FilterTabs
          label="Request status"
          options={tabs.map((t) => ({
            href: t.value === "open" ? "/shop/requests" : `/shop/requests?status=${t.value}`,
            label: t.label,
            current: t === tab,
          }))}
        />
        <RequestTable rows={rows} variant="shop" emptyTitle={tab.empty} />
      </div>
    </>
  );
}
