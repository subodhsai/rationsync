import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { SlotCalendar } from "@/components/visit-lists";
import { requireApprovedShop } from "@/lib/session";
import { getShopSlots, serverNow } from "@/lib/visit-data";

export const metadata: Metadata = { title: "Appointments" };

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Appointments />
    </Suspense>
  );
}

async function Appointments() {
  const session = await requireApprovedShop();
  const [slots, now] = await Promise.all([getShopSlots(session, 14), serverNow()]);

  return (
    <>
      <PageHeader title="Appointments" meta="Collection times for the next 14 days. Pause a time to stop new bookings, or close it to cancel them.">
        <div className="flex flex-wrap gap-2">
          <Link href="/shop/appointments/schedule" className={buttonVariants({ variant: "outline", size: "lg" })}>
            Weekly schedule
          </Link>
          <Link href="/shop/appointments/history" className={buttonVariants({ variant: "ghost", size: "lg" })}>
            History and attendance
          </Link>
        </div>
      </PageHeader>
      <SlotCalendar slots={slots} now={now} />
    </>
  );
}
