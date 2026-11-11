import {
  estimateWait,
  formatBookingCode,
  SERVICE_WINDOW_DAYS,
  type BeneficiaryBooking,
  type BookingStatus,
  type QueueEntry,
  type QueuePosition,
  type QueueStatus,
  type ShopAppointment,
} from "@rationsync/shared";
import type { Db } from "./db.js";

// Phase 4 read queries. Callers enforce role and ownership before using them.

export const maskCardNumber = (cardNumber: string) =>
  cardNumber.length <= 4 ? cardNumber : `${"•".repeat(cardNumber.length - 2)}${cardNumber.slice(-2)}`;

/** Seconds at the counter for visits completed at the shop in the recent window. */
export async function serviceDurations(db: Db, shopId: string): Promise<number[]> {
  const { rows } = await db.query<{ seconds: number }>(
    `select extract(epoch from finished_at - called_at)::float8 as seconds
       from public.queue_entries
      where shop_id = $1 and status = 'served' and finished_at > now() - interval '${SERVICE_WINDOW_DAYS} days'`,
    [shopId],
  );
  return rows.map((r) => r.seconds);
}

export async function queuePosition(
  db: Db,
  entry: { shopId: string; number: number; status: QueueStatus; serviceDate: string },
): Promise<QueuePosition> {
  const { rows } = await db.query<{ serving: number | null; ahead: number }>(
    `select (select number from public.queue_entries
              where shop_id = $1 and service_date = $2::date and status = 'serving') as serving,
            (select count(*)::int from public.queue_entries
              where shop_id = $1 and service_date = $2::date and status = 'waiting' and number < $3) as ahead`,
    [entry.shopId, entry.serviceDate, entry.number],
  );
  const { serving, ahead } = rows[0]!;
  // The person at the counter is ahead of every waiting number.
  const peopleAhead = entry.status === "waiting" ? ahead + (serving !== null ? 1 : 0) : 0;
  return {
    number: entry.number,
    status: entry.status,
    nowServing: serving,
    peopleAhead,
    estimate: estimateWait(await serviceDurations(db, entry.shopId), peopleAhead),
  };
}

interface BookingRow extends Omit<BeneficiaryBooking, "queue" | "token"> {
  token: string;
  shopId: string;
  queueNumber: number | null;
  queueStatus: QueueStatus | null;
  serviceDate: string | null;
}

const bookingSelect = `
  select b.id, b.status, s.starts_at as "startsAt", s.ends_at as "endsAt", b.check_code as code, b.token,
         json_build_object('name', sh.name, 'fpsId', sh.fps_id, 'address', sh.address) as shop,
         b.created_at as "createdAt", b.cancelled_at as "cancelledAt", b.cancel_reason as "cancelReason",
         b.checked_in_at as "checkedInAt", b.no_show_at as "noShowAt", b.rescheduled_from as "rescheduledFrom",
         s.shop_id as "shopId", q.number as "queueNumber", q.status as "queueStatus", q.service_date::text as "serviceDate"
    from public.bookings b
    join public.appointment_slots s on s.id = b.slot_id
    join public.shops sh on sh.id = s.shop_id
    left join public.queue_entries q on q.booking_id = b.id`;

/** A household's bookings. The token is included only when asked for, on the owner's own detail view. */
export async function loadBookings(
  db: Db,
  where: string,
  params: unknown[],
  tail: string,
  { withToken = false } = {},
): Promise<BeneficiaryBooking[]> {
  const { rows } = await db.query<BookingRow>(`${bookingSelect} where ${where} ${tail}`, params);
  return Promise.all(
    rows.map(async ({ token, shopId, queueNumber, queueStatus, serviceDate, code, ...b }) => ({
      ...b,
      code: formatBookingCode(code),
      ...(withToken && b.status === "booked" ? { token } : {}),
      queue:
        queueNumber !== null && queueStatus !== null && serviceDate !== null
          ? await queuePosition(db, { shopId, number: queueNumber, status: queueStatus, serviceDate })
          : null,
    })),
  );
}

export const queueEntrySelect = `
  select q.id, q.number, q.status, case when q.booking_id is null then 'walk_in' else 'booking' end as kind,
         q.note, b.check_code as "bookingCode", s.starts_at as "slotStartsAt", q.checked_in_at as "checkedInAt",
         q.called_at as "calledAt", q.finished_at as "finishedAt"
    from public.queue_entries q
    left join public.bookings b on b.id = q.booking_id
    left join public.appointment_slots s on s.id = b.slot_id`;

export async function loadQueueEntries(db: Db, where: string, params: unknown[]): Promise<QueueEntry[]> {
  const { rows } = await db.query<QueueEntry>(`${queueEntrySelect} where ${where} order by q.number`, params);
  return rows.map((e) => ({ ...e, bookingCode: e.bookingCode ? formatBookingCode(e.bookingCode) : null }));
}

interface AppointmentRow extends Omit<ShopAppointment, "cardNumber"> {
  cardNumber: string;
  status: BookingStatus;
}

export async function loadAppointments(db: Db, where: string, params: unknown[], tail: string): Promise<ShopAppointment[]> {
  const { rows } = await db.query<AppointmentRow>(
    `select b.id, b.check_code as code, b.status, s.id as "slotId", s.starts_at as "startsAt", s.ends_at as "endsAt",
            rc.card_number as "cardNumber", rc.member_count as "memberCount", b.checked_in_at as "checkedInAt",
            q.number as "queueNumber"
       from public.bookings b
       join public.appointment_slots s on s.id = b.slot_id
       left join public.beneficiary_cards bc on bc.user_id = b.beneficiary_id
       left join public.demo_ration_cards rc on rc.id = bc.card_id
       left join public.queue_entries q on q.booking_id = b.id
      where ${where} ${tail}`,
    params,
  );
  return rows.map((a) => ({ ...a, code: formatBookingCode(a.code), cardNumber: maskCardNumber(a.cardNumber ?? "") }));
}
