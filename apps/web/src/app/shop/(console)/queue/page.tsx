import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton, Panel } from "@/components/page";
import { ActionButton, AutoRefresh, CheckInPanel, WalkInForm } from "@/components/visit-forms";
import { ExpectedList, FinishedList, NowServing, WaitingList, WaitText } from "@/components/visit-lists";
import { formatWeekdayDate } from "@/lib/format";
import { requireApprovedShop } from "@/lib/session";
import { callNext } from "@/lib/visit-actions";
import { getShopQueue, serverNow } from "@/lib/visit-data";

export const metadata: Metadata = { title: "Today's queue" };

export default function QueuePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Queue />
    </Suspense>
  );
}

async function Queue() {
  const session = await requireApprovedShop();
  const queue = await getShopQueue(session);
  const now = await serverNow();

  return (
    <>
      <PageHeader
        title="Today's queue"
        meta={`${formatWeekdayDate(`${queue.date}T12:00:00+05:30`)} · ${queue.waiting.length} waiting · updates every 20 seconds`}
      />
      <AutoRefresh seconds={20} />
      <p className="text-[0.875rem] text-muted-foreground">
        Attendance only. Checking someone in is not e-POS authentication, and marking a visit served records no distribution and
        changes no stock.
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Panel title="At the counter">
            <NowServing entry={queue.nowServing} />
            {!queue.nowServing && queue.waiting.length > 0 && (
              <div className="mt-3">
                <ActionButton action={callNext} label={`Call number ${queue.waiting[0]!.number}`} variant="default" />
              </div>
            )}
          </Panel>

          <section aria-labelledby="waiting" className="space-y-3">
            <h2 id="waiting" className="text-lg font-semibold">
              Waiting
            </h2>
            <WaitingList items={queue.waiting} />
            <WaitText estimate={queue.estimate} />
          </section>

          <section aria-labelledby="expected" className="space-y-3">
            <h2 id="expected" className="text-lg font-semibold">
              Booked, not arrived yet
            </h2>
            <ExpectedList items={queue.expected} now={now} />
          </section>

          <FinishedList items={queue.finished} />
        </div>

        <div className="space-y-6 lg:sticky lg:top-6">
          <Panel title="Check in a booking">
            <CheckInPanel />
          </Panel>
          <Panel title="Walk-in" description="Anyone without a booking is served. Add them to the queue here.">
            <WalkInForm />
          </Panel>
        </div>
      </div>
    </>
  );
}
