import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { ShopStatusLabel } from "@/components/status";
import { getReviewHistory } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Decisions" };

export default function DecisionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Decisions />
    </Suspense>
  );
}

async function Decisions() {
  const session = await requireRole("warehouse_admin");
  const items = await getReviewHistory(session);
  const header = (
    <PageHeader title="Decisions" meta="Every approval and rejection for your warehouses, with who decided and why. Newest first." />
  );
  if (items.length === 0) {
    return (
      <>
        {header}
        <EmptyState title="No decisions recorded yet" />
      </>
    );
  }

  return (
    <>
      {header}
      <ol className="divide-y divide-border rounded-lg border border-border bg-card">
        {items.map((r) => (
          <li key={r.id} className="grid gap-2 p-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
            <div className="space-y-1.5">
              <ShopStatusLabel status={r.decision} />
              <p className="text-[0.8125rem] text-muted-foreground tabular-nums">{formatDateTime(r.createdAt)}</p>
            </div>
            <div className="min-w-0 space-y-1">
              <p>
                <Link href={`/warehouse/shops/${r.shopId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {r.shopName}
                </Link>{" "}
                <span className="font-mono text-[0.8125rem] text-muted-foreground">{r.fpsId}</span>
              </p>
              <p className="text-[0.9375rem]">{r.reason}</p>
              <p className="text-[0.8125rem] text-muted-foreground">{r.reviewerName || "Warehouse administrator"}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
