import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { SlotPicker } from "@/components/visit-forms";
import { getBeneficiaryOverview } from "@/lib/data";
import { formatTimeRange, formatWeekdayDate } from "@/lib/format";
import { beneficiaryText } from "@/lib/messages";
import { requireRole } from "@/lib/session";
import { getCollectionSlots } from "@/lib/visit-data";

export const metadata: Metadata = { title: "Book a collection time" };

export default function BookPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Book />
    </Suspense>
  );
}

// One active booking per household: with one already, this page moves it instead.
async function Book() {
  const session = await requireRole("beneficiary");
  const overview = await getBeneficiaryOverview(session);
  if (!overview.card || !overview.shop) redirect("/beneficiary/link-card");
  const current = overview.upcomingBooking;
  if (current && current.status !== "booked") redirect(`/beneficiary/visits/${current.id}`);
  const slots = await getCollectionSlots(session);

  return (
    <>
      <PageHeader
        title={current ? "Move your visit" : "Book a collection time"}
        meta={
          current ? (
            <>
              Now booked for {formatWeekdayDate(current.startsAt)}, {formatTimeRange(current.startsAt, current.endsAt)}. Choose a new time;
              the old one is released when you confirm.
            </>
          ) : (
            `At ${overview.shop.name}, in the next seven days.`
          )
        }
      />
      <SlotPicker slots={slots} reschedule={current ? { bookingId: current.id, currentStartsAt: current.startsAt } : undefined} />
      <p className="text-[0.875rem] text-muted-foreground">
        {beneficiaryText.en.walkInPromise} A booking does not guarantee stock.{" "}
        <Link href="/beneficiary/help" className="text-primary underline-offset-4 hover:underline">
          How booking works
        </Link>
      </p>
    </>
  );
}
