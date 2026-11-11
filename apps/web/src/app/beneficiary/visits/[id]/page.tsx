import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BookingQr } from "@/components/booking-qr";
import { BackLink, DetailList, PageSkeleton } from "@/components/page";
import { BookingStatusLabel } from "@/components/status";
import { ConfirmAction } from "@/components/supply-forms";
import { buttonVariants } from "@/components/ui/button";
import { AutoRefresh } from "@/components/visit-forms";
import { QueuePanel } from "@/components/visit-lists";
import { formatDateTime, formatTimeRange, formatWeekdayDate } from "@/lib/format";
import { beneficiaryText } from "@/lib/messages";
import { requireRole } from "@/lib/session";
import { cancelBooking } from "@/lib/visit-actions";
import { getMyBooking } from "@/lib/visit-data";

export const metadata: Metadata = { title: "Your visit" };

export default function VisitPage({ params, searchParams }: PageProps<"/beneficiary/visits/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Visit params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Visit({ params, searchParams }: Pick<PageProps<"/beneficiary/visits/[id]">, "params" | "searchParams">) {
  const session = await requireRole("beneficiary");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const b = await getMyBooking(session, id);
  if (!b) notFound();
  const active = b.status === "booked";
  const rows: Array<[string, React.ReactNode]> = [
    ["Shop", `${b.shop.name}, ${b.shop.address}`],
    ["Booked on", formatDateTime(b.createdAt)],
  ];
  if (b.checkedInAt) rows.push(["Checked in", formatDateTime(b.checkedInAt)]);
  if (b.cancelledAt) rows.push(["Cancelled", `${formatDateTime(b.cancelledAt)}${b.cancelReason ? `. ${b.cancelReason}` : ""}`]);
  if (b.noShowAt) rows.push(["Not checked in", "The shop did not record your arrival for this time."]);
  if (b.rescheduledFrom) rows.push(["Moved from", "an earlier booking, now released"]);

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/beneficiary/visits">Your visits</BackLink>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">{formatWeekdayDate(b.startsAt)}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem]">
            <span className="tabular-nums">{formatTimeRange(b.startsAt, b.endsAt)}</span>
            <BookingStatusLabel status={b.status} />
          </p>
        </div>
      </div>
      {(query.booked || query.moved) && (
        <p role="status" className="rounded-lg border border-primary/25 bg-primary-tint px-4 py-3 text-[0.9375rem] text-primary">
          {query.moved ? "Visit moved. Your old time was released." : "Booked. A confirmation is in your notifications."}
        </p>
      )}

      {b.queue && (
        <>
          <QueuePanel queue={b.queue} />
          {(b.queue.status === "waiting" || b.queue.status === "serving") && <AutoRefresh seconds={15} />}
        </>
      )}

      {active && b.token && (
        <section aria-labelledby="pass" className="space-y-4 rounded-lg border border-border bg-card p-4 text-center sm:p-6">
          <h2 id="pass" className="text-lg font-semibold">
            Show this at the shop
          </h2>
          <BookingQr token={b.token} label={`Booking QR code. Booking code ${b.code}`} />
          <div>
            <p className="text-[0.8125rem] text-muted-foreground">Booking code</p>
            <p className="font-mono text-2xl font-semibold tracking-wider">{b.code}</p>
          </div>
          <p className="text-[0.875rem] text-muted-foreground">
            The shop scans the code, or types the booking code if scanning does not work. It contains no personal details.
          </p>
        </section>
      )}

      {active && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/beneficiary/book" className={buttonVariants({ size: "lg", variant: "outline" })}>
            Move to another time
          </Link>
          <ConfirmAction
            action={cancelBooking.bind(null, b.id)}
            trigger="Cancel booking"
            triggerVariant="ghost"
            tone="destructive"
            question="Cancel this booking?"
            consequence="Your place is released. You can book again or walk in during shop hours."
            confirmLabel="Cancel booking"
          />
        </div>
      )}

      <DetailList rows={rows} />
      <p className="text-[0.875rem] text-muted-foreground">
        {beneficiaryText.en.checkInNote} {beneficiaryText.en.walkInPromise}
      </p>
    </>
  );
}
