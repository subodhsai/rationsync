import { SERVICE_WINDOW_DAYS } from "@rationsync/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BackLink, PageHeader, PageSkeleton, StatRow } from "@/components/page";
import { AppointmentTable } from "@/components/visit-lists";
import { requireApprovedShop } from "@/lib/session";
import { getAppointmentHistory, getAttendance } from "@/lib/visit-data";

export const metadata: Metadata = { title: "Appointment history" };

export default function HistoryPage({ searchParams }: PageProps<"/shop/appointments/history">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <History searchParams={searchParams} />
    </Suspense>
  );
}

async function History({ searchParams }: Pick<PageProps<"/shop/appointments/history">, "searchParams">) {
  const session = await requireApprovedShop();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const [summary, history] = await Promise.all([getAttendance(session), getAppointmentHistory(session, page)]);

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/shop/appointments">Appointments</BackLink>
        <PageHeader title="History and attendance" meta={`Counted from bookings and queue records for the last ${summary.days} days.`} />
      </div>

      <StatRow
        stats={[
          { label: "Bookings for past times", value: summary.booked },
          { label: "Checked in", value: summary.attended },
          { label: "Not attended", value: summary.notAttended, attention: true },
          { label: "Cancelled", value: summary.cancelled },
          { label: "Walk-ins", value: summary.walkIns },
          { label: "Called, not present", value: summary.calledNotPresent },
        ]}
      />
      <p className="text-[0.9375rem] text-muted-foreground">
        {summary.medianServiceMinutes !== null
          ? `About ${summary.medianServiceMinutes} min at the counter per visit, the median of ${summary.serviceSamples} visits in the last ${SERVICE_WINDOW_DAYS} days.`
          : `Not enough completed visits in the last ${SERVICE_WINDOW_DAYS} days to give a typical counter time (${summary.serviceSamples} so far, 5 needed).`}
      </p>

      <section aria-labelledby="past" className="space-y-3">
        <h2 id="past" className="text-lg font-semibold">
          Past appointments
        </h2>
        <AppointmentTable items={history.items} />
        {(page > 1 || history.hasMore) && (
          <nav aria-label="Pages" className="flex justify-between text-[0.9375rem] font-medium">
            {page > 1 ? (
              <Link href={`/shop/appointments/history?page=${page - 1}`} className="inline-flex min-h-11 items-center text-primary">
                Newer
              </Link>
            ) : (
              <span />
            )}
            {history.hasMore && (
              <Link href={`/shop/appointments/history?page=${page + 1}`} className="inline-flex min-h-11 items-center text-primary">
                Older
              </Link>
            )}
          </nav>
        )}
      </section>
    </>
  );
}
