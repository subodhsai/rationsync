import type { BeneficiaryBooking, QueueEntry, QueuePosition, ShopAppointment, ShopSlot, WaitEstimate } from "@rationsync/shared";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/page";
import { BookingStatusLabel, QueueStatusLabel, SlotStatusLabel } from "@/components/status";
import { ConfirmAction } from "@/components/supply-forms";
import { ActionButton } from "@/components/visit-forms";
import { formatShortDay, formatTime, formatTimeRange, formatWeekdayDate, istDateKey } from "@/lib/format";
import { changeSlotPause, finishEntry, markNoShow, setSlotStatus } from "@/lib/visit-actions";
import { cn } from "@/lib/utils";

export function WaitText({ estimate }: { estimate: WaitEstimate }) {
  return estimate.status === "estimate" ? (
    <p className="text-[0.9375rem]">
      <span className="font-medium">About {estimate.minutes} min</span>{" "}
      <span className="text-muted-foreground">Estimate from recent visits, not a promise. {estimate.basis}</span>
    </p>
  ) : (
    <p className="text-[0.9375rem] text-muted-foreground">No reliable waiting-time estimate yet. {estimate.basis}</p>
  );
}

/**
 * The household's place in today's queue, as one announced status. Shown only after
 * check-in; the numbers come from the shop's queue records.
 */
export function QueuePanel({ queue }: { queue: QueuePosition }) {
  const sentence =
    queue.status === "serving"
      ? `Number ${queue.number}: please go to the counter.`
      : queue.status === "waiting"
        ? `Number ${queue.number}: ${queue.peopleAhead === 0 ? "you are next" : `${queue.peopleAhead} ${queue.peopleAhead === 1 ? "person" : "people"} ahead of you`}.`
        : queue.status === "served"
          ? `Number ${queue.number}: visit completed.`
          : `Number ${queue.number} was called but not present. Speak to the shop if you are there.`;
  return (
    <section aria-labelledby="queue" className={cn("rounded-lg border p-4 sm:p-5", queue.status === "serving" ? "border-primary bg-primary-tint" : "border-border bg-card")}>
      <h2 id="queue" className="text-[0.9375rem] font-medium text-muted-foreground">
        Your queue number
      </h2>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="font-mono text-5xl font-semibold tabular-nums">{queue.number}</p>
        <QueueStatusLabel status={queue.status} />
      </div>
      <p role="status" className="mt-3 text-lg font-medium">
        {sentence}
      </p>
      {queue.status === "waiting" && (
        <div className="mt-2 space-y-1">
          <p className="text-[0.9375rem]">{queue.nowServing ? `Now serving number ${queue.nowServing}.` : "Nobody is at the counter yet."}</p>
          <WaitText estimate={queue.estimate} />
        </div>
      )}
    </section>
  );
}

export function BookingList({ items, emptyTitle, children }: { items: BeneficiaryBooking[]; emptyTitle: string; children?: React.ReactNode }) {
  if (items.length === 0) return <EmptyState title={emptyTitle}>{children}</EmptyState>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((b) => (
        <li key={b.id}>
          <Link href={`/beneficiary/visits/${b.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{formatWeekdayDate(b.startsAt)}</p>
              <p className="text-[0.875rem] text-muted-foreground tabular-nums">
                {formatTimeRange(b.startsAt, b.endsAt)} · {b.shop.name}
              </p>
            </div>
            <BookingStatusLabel status={b.status} />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Shop ----------------------------------------------------------------------------

function EntryRow({ e, actions }: { e: QueueEntry; actions?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <p className="w-12 font-mono text-2xl font-semibold tabular-nums">{e.number}</p>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {e.kind === "walk_in" ? "Walk-in" : "Booked"}
          {e.bookingCode && <span className="ml-2 font-mono text-[0.8125rem] font-normal text-muted-foreground">{e.bookingCode}</span>}
        </p>
        <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
          Arrived {formatTime(e.checkedInAt)}
          {e.slotStartsAt && ` · booked for ${formatTime(e.slotStartsAt)}`}
          {e.note && ` · ${e.note}`}
        </p>
      </div>
      {actions ?? <QueueStatusLabel status={e.status} />}
    </li>
  );
}

export function NowServing({ entry }: { entry: QueueEntry | null }) {
  if (!entry) return <p className="text-[0.9375rem] text-muted-foreground">Nobody is at the counter.</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <p className="font-mono text-5xl font-semibold tabular-nums">{entry.number}</p>
        <div>
          <p className="font-medium">{entry.kind === "walk_in" ? "Walk-in" : "Booked visit"}</p>
          <p className="text-[0.875rem] text-muted-foreground tabular-nums">
            Called {formatTime(entry.calledAt!)}
            {entry.note && ` · ${entry.note}`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton action={finishEntry.bind(null, entry.id, "served")} label="Served" variant="default" />
        <ActionButton action={finishEntry.bind(null, entry.id, "no_show")} label="Not present" />
      </div>
    </div>
  );
}

export function WaitingList({ items }: { items: QueueEntry[] }) {
  if (items.length === 0) return <EmptyState title="Nobody is waiting" />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((e) => (
        <EntryRow
          key={e.id}
          e={e}
          actions={<ActionButton action={finishEntry.bind(null, e.id, "no_show")} label="Mark as left" variant="ghost" className="text-muted-foreground" />}
        />
      ))}
    </ul>
  );
}

export function FinishedList({ items }: { items: QueueEntry[] }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium">Finished today ({items.length})</summary>
      <ul className="divide-y divide-border border-t border-border">
        {items.map((e) => (
          <EntryRow key={e.id} e={e} />
        ))}
      </ul>
    </details>
  );
}

/** Today's bookings not yet checked in. Once a slot starts, a missing household can be marked. */
export function ExpectedList({ items, now }: { items: ShopAppointment[]; now: number }) {
  if (items.length === 0) return <EmptyState title="No more bookings expected today" />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium tabular-nums">{formatTimeRange(a.startsAt, a.endsAt)}</p>
            <p className="text-[0.8125rem] text-muted-foreground">
              <span className="font-mono">{a.code}</span> · card {a.cardNumber} · {a.memberCount} {a.memberCount === 1 ? "member" : "members"}
            </p>
          </div>
          {Date.parse(a.startsAt) <= now ? (
            <ConfirmAction
              action={markNoShow.bind(null, a.id)}
              trigger="Not attended"
              triggerVariant="ghost"
              question="Mark this booking not attended?"
              consequence="The household is told and can book again or walk in."
              confirmLabel="Mark not attended"
            />
          ) : (
            <BookingStatusLabel status={a.status} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function AppointmentTable({ items }: { items: ShopAppointment[] }) {
  if (items.length === 0) return <EmptyState title="No past appointments yet" />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {formatShortDay(a.startsAt)}, <span className="tabular-nums">{formatTimeRange(a.startsAt, a.endsAt)}</span>
            </p>
            <p className="text-[0.8125rem] text-muted-foreground">
              <span className="font-mono">{a.code}</span> · card {a.cardNumber}
              {a.checkedInAt && ` · arrived ${formatTime(a.checkedInAt)}`}
              {a.queueNumber !== null && ` · number ${a.queueNumber}`}
            </p>
          </div>
          <BookingStatusLabel status={a.status} />
        </li>
      ))}
    </ul>
  );
}

/** Upcoming slots grouped by day, with bookings against bookable places and pause or close controls. */
export function SlotCalendar({ slots, now }: { slots: ShopSlot[]; now: number }) {
  if (slots.length === 0) {
    return <EmptyState title="No slots published">Save a weekly schedule, then publish slots to open bookings.</EmptyState>;
  }
  const days = [...new Set(slots.map((s) => istDateKey(s.startsAt)))];
  return (
    <div className="space-y-6">
      {days.map((d) => {
        const daySlots = slots.filter((s) => istDateKey(s.startsAt) === d);
        return (
          <section key={d} aria-label={formatWeekdayDate(daySlots[0]!.startsAt)} className="space-y-2">
            <h3 className="font-semibold">{formatWeekdayDate(daySlots[0]!.startsAt)}</h3>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {daySlots.map((s) => {
                const bookable = s.capacity - s.walkInReserve;
                const past = Date.parse(s.endsAt) <= now;
                const started = Date.parse(s.startsAt) <= now;
                return (
                  <li key={s.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center">
                    <p className="font-medium whitespace-nowrap tabular-nums">{formatTimeRange(s.startsAt, s.endsAt)}</p>
                    <div className="space-y-1.5">
                      <p className="text-[0.875rem] tabular-nums">
                        {s.booked} of {bookable} bookable places taken
                        <span className="text-muted-foreground"> · {s.walkInReserve} kept for walk-ins</span>
                        {past && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {s.checkedIn} checked in, {s.notAttended} not attended
                          </span>
                        )}
                      </p>
                      <div aria-hidden="true" className="h-1.5 max-w-xs overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, (s.booked / Math.max(bookable, 1)) * 100)}%` }} />
                      </div>
                      {s.statusReason && <p className="text-[0.8125rem] text-muted-foreground">{s.statusReason}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {/* Bookings stop when a slot starts, so pause and close only apply before then. */}
                      {past ? (
                        <span className="text-[0.875rem] text-muted-foreground">Finished</span>
                      ) : started && s.status !== "closed" ? (
                        <span className="text-[0.875rem] text-muted-foreground">In progress, no new bookings</span>
                      ) : (
                        <>
                          <SlotStatusLabel status={s.status} />
                          {s.status !== "closed" && <SlotControls slotId={s.id} status={s.status} booked={s.booked} />}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SlotControls({ slotId, status, booked }: { slotId: string; status: ShopSlot["status"]; booked: number }) {
  return (
    <>
      <ActionButton
        action={changeSlotPause.bind(null, slotId, status === "paused" ? "open" : "paused")}
        label={status === "paused" ? "Resume" : "Pause"}
        variant="ghost"
      />
      <ConfirmAction
        action={setSlotStatus.bind(null, slotId)}
        trigger="Close"
        triggerVariant="ghost"
        tone="destructive"
        question="Close this collection time?"
        consequence={
          booked
            ? `${booked} booked ${booked === 1 ? "household is" : "households are"} cancelled and told your reason. This cannot be undone.`
            : "No new bookings can be made. This cannot be undone."
        }
        confirmLabel="Close slot"
        reason={{ name: "reason", label: "Reason shown to households", hint: "For example: stock delivery at that time" }}
        hidden={{ status: "closed" }}
      />
    </>
  );
}
