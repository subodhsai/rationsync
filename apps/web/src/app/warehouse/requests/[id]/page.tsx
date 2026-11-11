import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink, DetailList, PageSkeleton, Panel } from "@/components/page";
import { PriorityLabel, RequestStatusLabel, ShipmentStatusLabel } from "@/components/status";
import { DecisionForm } from "@/components/supply-forms";
import { ForecastText, QuantityTrail, Qty } from "@/components/supply-lists";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { getWarehouseRequest } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Request" };

export default function WarehouseRequestPage({ params }: PageProps<"/warehouse/requests/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: Pick<PageProps<"/warehouse/requests/[id]">, "params">) {
  const session = await requireRole("warehouse_admin");
  const r = await getWarehouseRequest(session, (await params).id);
  if (!r) notFound();
  const shipped = r.shipment && r.shipment.status !== "preparing" && r.shipment.status !== "cancelled";
  const rows: Array<[string, React.ReactNode]> = [
    ["Shop", <Link key="shop" href={`/warehouse/shops/${r.shopId}`} className="text-primary underline-offset-4 hover:underline">{r.shopName}</Link>],
    ["FPS ID", <span key="fps" className="font-mono text-[0.875rem]">{r.fpsId}</span>],
    ["Stated priority", <PriorityLabel key="priority" priority={r.priority} />],
    ["Reason", r.reason],
    ["Shop stock when requested", `${formatQuantity(r.stockAtRequest)} ${r.unit}`],
    ["Submitted", `${formatDateTime(r.createdAt)}${r.requestedByName ? ` by ${r.requestedByName}` : ""}`],
  ];
  if (r.suggestedQuantity) rows.splice(5, 0, ["Suggested by RationSync", `${formatQuantity(r.suggestedQuantity)} ${r.unit}`]);
  if (r.decidedAt) {
    rows.push([r.status === "rejected" ? "Rejected" : "Approved", `${formatDateTime(r.decidedAt)}${r.decidedByName ? ` by ${r.decidedByName}` : ""}`]);
    rows.push(["Decision reason", r.decisionReason ?? ""]);
  }

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/warehouse/requests">Requests</BackLink>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] sm:text-[1.75rem]">
            {r.commodityName}, {formatQuantity(r.requestedQuantity)} {r.unit} for {r.shopName}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem] text-muted-foreground">
            <span className="font-mono text-[0.875rem]">{r.reference}</span>
            <RequestStatusLabel status={r.status} />
          </p>
        </div>
      </div>

      <QuantityTrail
        unit={r.unit}
        requested={r.requestedQuantity}
        approved={r.approvedQuantity}
        dispatched={shipped ? r.approvedQuantity : null}
        received={r.receivedQuantity}
        damaged={null}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Panel title="Stock check" description="Current figures, before you decide.">
            <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              <div className="bg-card px-4 py-3">
                <dt className="text-[0.8125rem] text-muted-foreground">Shop has now</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {r.shopStock ? <Qty value={r.shopStock.onHand} unit={r.unit} /> : <span className="text-[0.9375rem] font-normal text-muted-foreground">Not stocked</span>}
                </dd>
                {r.shopStock && (
                  <dd className="text-[0.8125rem] text-muted-foreground tabular-nums">
                    Threshold {formatQuantity(r.shopStock.threshold)} {r.unit}
                    {r.shopStock.target !== null && ` · target ${formatQuantity(r.shopStock.target)} ${r.unit}`}
                  </dd>
                )}
              </div>
              <div className="bg-card px-4 py-3">
                <dt className="text-[0.8125rem] text-muted-foreground">Warehouse can allocate</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {r.warehouseStock ? <Qty value={r.warehouseStock.available} unit={r.unit} /> : <span className="text-[0.9375rem] font-normal text-muted-foreground">None held</span>}
                </dd>
                {r.warehouseStock && (
                  <dd className="text-[0.8125rem] text-muted-foreground tabular-nums">
                    {formatQuantity(r.warehouseStock.onHand)} on hand, {formatQuantity(r.warehouseStock.reserved)} reserved
                  </dd>
                )}
              </div>
            </dl>
            <div className="mt-4 space-y-3">
              <div>
                <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-medium">
                  Recommended priority <PriorityLabel priority={r.recommendation.priority} />
                </p>
                <p className="mt-1 text-[0.9375rem] text-muted-foreground">{r.recommendation.reason}</p>
              </div>
              <div>
                <p className="text-[0.9375rem] font-medium">Coverage at the shop</p>
                <ForecastText forecast={r.forecast} />
              </div>
            </div>
          </Panel>
          <Panel title="Request">
            <DetailList rows={rows} />
          </Panel>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6">
          {r.status === "pending" && (
            <Panel title="Decision">
              <DecisionForm request={r} />
            </Panel>
          )}
          {r.shipment && (
            <Panel title="Shipment">
              <Link href={`/warehouse/shipments/${r.shipment.id}`} className="flex min-h-11 items-center justify-between gap-3 font-mono text-primary underline-offset-4 hover:underline">
                {r.shipment.reference}
                <ShipmentStatusLabel status={r.shipment.status} />
              </Link>
            </Panel>
          )}
          {r.status === "approved" && !r.shipment && (
            <Panel title="Next step" description="The approved quantity is reserved. Add it to a shipment to dispatch it.">
              <Link href={`/warehouse/shipments/new?shopId=${r.shopId}`} className={buttonVariants({ size: "lg" })}>
                Prepare shipment
              </Link>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
