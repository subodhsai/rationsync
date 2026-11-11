import { AWAITING_RECEIPT } from "@rationsync/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink, PageSkeleton, Panel } from "@/components/page";
import { ShipmentStatusLabel } from "@/components/status";
import { ConfirmAction, ReceiveForm } from "@/components/supply-forms";
import { ShipmentEvents, ShipmentItems } from "@/components/supply-lists";
import { formatDate } from "@/lib/format";
import { requireApprovedShop } from "@/lib/session";
import { disputeShipment } from "@/lib/supply-actions";
import { getShopShipment } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Shipment" };

export default function ShopShipmentPage({ params }: PageProps<"/shop/shipments/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: Pick<PageProps<"/shop/shipments/[id]">, "params">) {
  const session = await requireApprovedShop();
  const shipment = await getShopShipment(session, (await params).id);
  if (!shipment) notFound();
  const awaiting = AWAITING_RECEIPT.includes(shipment.status);

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/shop/shipments">Incoming shipments</BackLink>
        <div className="space-y-1">
          <h1 className="font-mono text-2xl font-semibold sm:text-[1.75rem]">{shipment.reference}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem] text-muted-foreground">
            <ShipmentStatusLabel status={shipment.status} />
            From {shipment.warehouseName} · expected {formatDate(shipment.expectedDeliveryDate)}
          </p>
        </div>
      </div>

      {awaiting ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel
            title="Confirm what arrived"
            description="Count the stock before confirming. Only goods in good condition are added to your inventory; anything short or damaged is reported to the warehouse."
          >
            <ReceiveForm shipment={shipment} />
          </Panel>
          <div className="space-y-6">
            <Panel title="History">
              <ShipmentEvents shipment={shipment} />
            </Panel>
            {shipment.status !== "disputed" && (
              <ConfirmAction
                action={disputeShipment.bind(null, shipment.id)}
                trigger="Report a problem"
                question="Report this shipment to the warehouse?"
                consequence="Use this if it has not arrived or the goods are wrong. You can still confirm the delivery later."
                confirmLabel="Send report"
                tone="destructive"
                triggerVariant="ghost"
                reason={{ name: "reason", label: "What is wrong", hint: "For example: not arrived two days after the expected date" }}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="items" className="space-y-3">
            <h2 id="items" className="text-lg font-semibold">
              Items
            </h2>
            <ShipmentItems shipment={shipment} area="shop" />
            {shipment.receiptNote && <p className="text-[0.9375rem] text-muted-foreground">Your note: {shipment.receiptNote}</p>}
          </section>
          <Panel title="History">
            <ShipmentEvents shipment={shipment} />
          </Panel>
        </div>
      )}
    </>
  );
}
