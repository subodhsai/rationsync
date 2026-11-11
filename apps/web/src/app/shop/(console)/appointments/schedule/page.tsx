import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink, PageHeader, PageSkeleton, Panel } from "@/components/page";
import { PublishForm, ScheduleForm } from "@/components/visit-forms";
import { requireApprovedShop } from "@/lib/session";
import { getSchedule } from "@/lib/visit-data";

export const metadata: Metadata = { title: "Weekly schedule" };

export default function SchedulePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Schedule />
    </Suspense>
  );
}

async function Schedule() {
  const session = await requireApprovedShop();
  const windows = await getSchedule(session);
  return (
    <>
      <div className="space-y-2">
        <BackLink href="/shop/appointments">Appointments</BackLink>
        <PageHeader
          title="Weekly schedule"
          meta="When households can book, how many visitors each slot takes, and how many places stay free for walk-ins. Times are India Standard Time."
        />
      </div>
      <Panel title="Publish slots" description="Creates bookable times from the schedule. Times that already exist are left as they are.">
        <PublishForm />
      </Panel>
      <ScheduleForm initial={windows} />
    </>
  );
}
