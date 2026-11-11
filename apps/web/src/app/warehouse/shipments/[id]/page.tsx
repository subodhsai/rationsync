import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink, PageSkeleton, Panel } from "@/components/page";
import { ShipmentStatusLabel } from "@/components/status";
import { ConfirmAction } from "@/components/supply-forms";
import { ShipmentEvents, ShipmentItems } from "@/components/supply-lists";
import { formatDate, formatQuantity, todayIst } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { cancelShipment, dispatchShipment, markInTransit, resolveDiscrepancy } from "@/lib/supply-actions";
import { getWarehouseShipment } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Shipment" };

export default function WarehouseShipmentPage({ params, searchParams }: PageProps<"/warehouse/shipments/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: Pick<PageProps<"/warehouse/shipments/[id]">, "params" | "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const s = await getWarehouseShipment(session, id);
  if (!s) notFound();
  const today = todayIst();
  const open = s.detailItems.filter((i) => i.discrepancy?.status === "open");
  const contents = s.items.map((i) => `${formatQuantity(i.quantity)} ${i.unit} of ${i.commodityName.toLowerCase()}`).join(", ");

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/warehouse/shipments">Shipments</BackLink>
        <div className="space-y-1">
          <h1 className="font-mono text-2xl font-semibold sm:text-[1.75rem]">{s.reference}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem] text-muted-foreground">
            <ShipmentStatusLabel status={s.status} />
            <span>
              To{" "}
              <Link href={`/warehouse/shops/${s.shopId}`} className="text-primary underline-offset-4 hover:underline">
                {s.shopName}
              </Link>{" "}
              from {s.warehouseName} · expected {formatDate(s.expectedDeliveryDate)}
            </span>
          </p>
        </div>
      </div>
      {query.created && (
        <p role="status" className="rounded-lg border border-primary/25 bg-primary-tint px-4 py-3 text-[0.9375rem] text-primary">
          Shipment prepared. Stock stays reserved until you confirm dispatch.
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section aria-labelledby="items" className="space-y-3">
            <h2 id="items" className="text-lg font-semibold">
              Items
            </h2>
            <ShipmentItems shipment={s} area="warehouse" />
            {s.notes && <p className="text-[0.9375rem] text-muted-foreground">Dispatch notes: {s.notes}</p>}
            {s.receiptNote && <p className="text-[0.9375rem] text-muted-foreground">Shop&apos;s receipt note: {s.receiptNote}</p>}
          </section>

          {open.length > 0 && (
            <Panel
              title="Resolve discrepancies"
              description="Recording a resolution moves no stock. Send replacement goods on a new request and shipment so every quantity stays traceable."
            >
              <ul className="space-y-4">
                {open.map((i) => (
                  <li key={i.id} className="space-y-2">
                    <p className="text-[0.9375rem] tabular-nums">
                      <span className="font-medium">{i.commodityName}:</span> {formatQuantity(i.discrepancy!.shortageQuantity)} {i.unit} short,{" "}
                      {formatQuantity(i.discrepancy!.damagedQuantity)} {i.unit} damaged
                    </p>
                    <ConfirmAction
                      action={resolveDiscrepancy.bind(null, i.discrepancy!.id)}
                      trigger="Record resolution"
                      question={`Resolve the ${i.commodityName.toLowerCase()} discrepancy?`}
                      consequence="The resolution is kept in the audit log and cannot be edited."
                      confirmLabel="Record resolution"
                      reason={{ name: "resolution", label: "How it was settled", hint: "For example: transporter liable; replacement sent on a new request" }}
                    />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-6 lg:sticky lg:top-6">
          {s.status === "preparing" && (
            <Panel title="Dispatch" description={`Sends ${contents}. Reserved stock leaves the warehouse and is counted as in transit.`}>
              <div className="flex flex-col items-start gap-3">
                <ConfirmAction
                  action={dispatchShipment.bind(null, s.id)}
                  trigger="Confirm dispatch"
                  triggerVariant="default"
                  question={`Dispatch ${s.reference}?`}
                  consequence="Warehouse stock is reduced now and the shop is told to expect it. This cannot be undone or cancelled afterwards."
                  confirmLabel="Dispatch now"
                  date={{ name: "expectedDeliveryDate", label: "Expected delivery date", min: today, defaultValue: s.expectedDeliveryDate < today ? today : s.expectedDeliveryDate }}
                />
                <ConfirmAction
                  action={cancelShipment.bind(null, s.id)}
                  trigger="Cancel shipment"
                  triggerVariant="ghost"
                  tone="destructive"
                  question={`Cancel ${s.reference}?`}
                  consequence="Its requests stay approved, with stock still reserved, and can go on another shipment."
                  confirmLabel="Cancel shipment"
                  reason={{ name: "reason", label: "Reason" }}
                />
              </div>
            </Panel>
          )}
          {s.status === "dispatched" && (
            <Panel title="On the road" description="Optional: mark it in transit once the vehicle has left. The shop confirms receipt.">
              <ConfirmAction
                action={markInTransit.bind(null, s.id)}
                trigger="Mark in transit"
                question={`Mark ${s.reference} in transit?`}
                consequence="Recorded with your name and the time."
                confirmLabel="Mark in transit"
              />
            </Panel>
          )}
          {s.status === "disputed" && (
            <Panel title="Disputed by the shop">
              <p className="text-[0.9375rem]">{s.disputeReason}</p>
              <p className="mt-2 text-[0.875rem] text-muted-foreground">The shop can still confirm the delivery once it arrives.</p>
            </Panel>
          )}
          <Panel title="History">
            <ShipmentEvents shipment={s} />
          </Panel>
        </div>
      </div>
    </>
  );
}
