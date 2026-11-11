import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink, DetailList, PageSkeleton, Panel } from "@/components/page";
import { PriorityLabel, RequestStatusLabel, ShipmentStatusLabel } from "@/components/status";
import { ConfirmAction } from "@/components/supply-forms";
import { QuantityTrail } from "@/components/supply-lists";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { requireApprovedShop } from "@/lib/session";
import { cancelRequest } from "@/lib/supply-actions";
import { getShopRequest } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Request" };

export default function ShopRequestPage({ params, searchParams }: PageProps<"/shop/requests/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: Pick<PageProps<"/shop/requests/[id]">, "params" | "searchParams">) {
  const session = await requireApprovedShop();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const r = await getShopRequest(session, id);
  if (!r) notFound();
  const shipped = r.shipment && r.shipment.status !== "preparing" && r.shipment.status !== "cancelled";
  const rows: Array<[string, React.ReactNode]> = [
    ["Priority", <PriorityLabel key="priority" priority={r.priority} />],
    ["Reason", r.reason],
    ["Stock when requested", `${formatQuantity(r.stockAtRequest)} ${r.unit}`],
  ];
  if (r.suggestedQuantity) rows.push(["Suggested quantity", `${formatQuantity(r.suggestedQuantity)} ${r.unit}`]);
  rows.push(["Submitted", `${formatDateTime(r.createdAt)}${r.requestedByName ? ` by ${r.requestedByName}` : ""}`]);
  if (r.decidedAt) {
    rows.push([
      r.status === "rejected" ? "Rejected" : "Approved",
      `${formatDateTime(r.decidedAt)}${r.decidedByName ? ` by ${r.decidedByName}` : ""}`,
    ]);
    rows.push(["Warehouse note", r.decisionReason ?? ""]);
  }
  if (r.status === "cancelled" && r.closedAt) rows.push(["Cancelled", formatDateTime(r.closedAt)]);

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/shop/requests">Requests</BackLink>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] sm:text-[1.75rem]">
            {r.commodityName}, {formatQuantity(r.requestedQuantity)} {r.unit}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem] text-muted-foreground">
            <span className="font-mono text-[0.875rem]">{r.reference}</span>
            <RequestStatusLabel status={r.status} />
          </p>
        </div>
      </div>
      {query.submitted && (
        <p role="status" className="rounded-lg border border-primary/25 bg-primary-tint px-4 py-3 text-[0.9375rem] text-primary">
          Request submitted. Your warehouse has been notified.
        </p>
      )}

      <QuantityTrail
        unit={r.unit}
        requested={r.requestedQuantity}
        approved={r.approvedQuantity}
        dispatched={shipped ? r.approvedQuantity : null}
        received={r.receivedQuantity}
        damaged={null}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Details">
          <DetailList rows={rows} />
        </Panel>

        <div className="space-y-4">
          {r.shipment && shipped && (
            <Panel title="Shipment">
              <Link
                href={`/shop/shipments/${r.shipment.id}`}
                className="flex min-h-11 items-center justify-between gap-3 font-mono text-primary underline-offset-4 hover:underline"
              >
                {r.shipment.reference}
                <ShipmentStatusLabel status={r.shipment.status} />
              </Link>
            </Panel>
          )}
          {r.status === "approved" && !shipped && (
            <p className="text-[0.9375rem] text-muted-foreground">
              The approved quantity is reserved at the warehouse. It is added to your stock only when you confirm the
              delivery.
            </p>
          )}
          {r.status === "pending" && (
            <ConfirmAction
              action={cancelRequest.bind(null, r.id)}
              trigger="Cancel request"
              question={`Cancel ${r.reference}?`}
              consequence="The warehouse will no longer see it. You can submit a new request later."
              confirmLabel="Cancel request"
              tone="destructive"
            />
          )}
        </div>
      </div>
    </>
  );
}
