import {
  estimateWait,
  formatBookingCode,
  stockLevel,
  type AttendanceSummary,
  type BeneficiaryBooking,
  type BeneficiaryOverview,
  type BookingStatus,
  type CollectionSlot,
  type QueueEntry,
  type ScheduleWindow,
  type ShopAppointment,
  type ShopQueue,
  type ShopSlot,
} from "@rationsync/shared";
import { demoInventory } from "@/lib/fixtures";

// FICTIONAL PREVIEW DATA for Phase 4: the demo household linked to Demo FPS Kuvempunagar and
// that shop's appointments and queue. Built from the current time so dates stay current.
// Counts shown in preview are computed from these records, never typed in.

const SHOP = { name: "Demo FPS Kuvempunagar", fpsId: "DEMO-FPS-MYS-0101", address: "2nd Cross, Kuvempunagar, Mysuru" };
const HOURS = [9, 10, 16, 17];

/** Today in India Standard Time, as YYYY-MM-DD. */
const istDate = (now: Date) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const at = (date: string, hour: number, minute = 0) =>
  new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`).toISOString();
const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const fakeId = (kind: string, n: number) => `0d9a0000-0000-4000-${kind}-${String(n).padStart(12, "0")}`;
const codeOf = (n: number) => (n * 2654435761).toString(16).toUpperCase().padStart(10, "0").slice(-10);

export const demoSchedule: ScheduleWindow[] = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
  { weekday, startTime: "09:00", endTime: "11:00", slotMinutes: 60 as const, capacity: 15, walkInReserve: 3 },
  { weekday, startTime: "16:00", endTime: "18:00", slotMinutes: 60 as const, capacity: 15, walkInReserve: 3 },
]);

// Bookings per slot follow a fixed pattern so some times are full and one is paused.
const bookedPattern = [11, 12, 4, 7, 2, 0, 9, 12, 5, 3, 8, 1];

function slotsFrom(now: Date, fromDay: number, days: number): ShopSlot[] {
  const today = istDate(now);
  const out: ShopSlot[] = [];
  let i = 0;
  for (let d = fromDay; d < fromDay + days; d++) {
    const date = addDays(today, d);
    if (isoWeekday(date) === 7) continue;
    for (const hour of HOURS) {
      const startsAt = at(date, hour);
      const past = Date.parse(startsAt) < now.getTime();
      const booked = bookedPattern[i % bookedPattern.length]!;
      const paused = d === 3 && hour === 16;
      out.push({
        id: fakeId("a100", d * 100 + hour),
        startsAt,
        endsAt: at(date, hour + 1),
        capacity: 15,
        walkInReserve: 3,
        booked,
        remaining: Math.max(15 - 3 - booked, 0),
        status: paused ? "paused" : "open",
        statusReason: paused ? "Stock delivery expected at that time" : null,
        checkedIn: past ? Math.max(booked - 2, 0) : 0,
        notAttended: past ? Math.min(booked, 2) : 0,
      });
      i++;
    }
  }
  return out;
}

/** Bookable times for the household: the next seven days, future slots only. */
export const demoCollectionSlots = (now: Date): CollectionSlot[] =>
  slotsFrom(now, 0, 8)
    .filter((s) => Date.parse(s.startsAt) > now.getTime())
    .map(({ checkedIn: _c, notAttended: _n, ...s }) => s);

export const demoShopSlots = (now: Date, days = 14): ShopSlot[] => slotsFrom(now, 0, days);

// Household bookings ----------------------------------------------------------

export const DEMO_TOKEN = "3f9c2a7d1e8b4c6fa0d5e2b7c9184f3a";

function booking(id: string, status: BookingStatus, startsAt: string, extra: Partial<BeneficiaryBooking> = {}): BeneficiaryBooking {
  return {
    id,
    status,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600_000).toISOString(),
    code: formatBookingCode(id === fakeId("b100", 1) ? DEMO_TOKEN.slice(0, 10).toUpperCase() : codeOf(Number(id.slice(-2)))),
    shop: SHOP,
    createdAt: new Date(Date.parse(startsAt) - 3 * 86400_000).toISOString(),
    cancelledAt: null,
    cancelReason: null,
    checkedInAt: null,
    noShowAt: null,
    rescheduledFrom: null,
    queue: null,
    ...extra,
  };
}

export function demoBookings(now: Date): { upcoming: BeneficiaryBooking[]; past: BeneficiaryBooking[] } {
  const today = istDate(now);
  let next = addDays(today, 1);
  if (isoWeekday(next) === 7) next = addDays(next, 1);
  const lastWeek = addDays(today, -7);
  return {
    upcoming: [booking(fakeId("b100", 1), "booked", at(next, 10), { token: DEMO_TOKEN })],
    past: [
      booking(fakeId("b100", 4), "checked_in", at(lastWeek, 9), { checkedInAt: at(lastWeek, 9, 12) }),
      booking(fakeId("b100", 3), "cancelled", at(addDays(lastWeek, -6), 16), {
        cancelledAt: at(addDays(lastWeek, -7), 18),
        cancelReason: "Cancelled by the household",
      }),
      booking(fakeId("b100", 2), "no_show", at(addDays(lastWeek, -14), 17), { noShowAt: at(addDays(lastWeek, -14), 19) }),
    ],
  };
}

export function demoBeneficiaryOverview(now: Date): BeneficiaryOverview {
  return {
    card: { cardNumber: "•••••••••01", category: "PHH", memberCount: 4, linkedAt: at(addDays(istDate(now), -40), 11) },
    shop: { ...SHOP, openingHours: "Mon to Sat, 8:00 to 12:00 and 16:00 to 20:00", contactPhone: "+91 90000 00101" },
    stock: demoInventory.map(({ commodityCode, nameEn, nameKn, unit, quantity, lowStockThreshold }) => ({
      commodityCode,
      nameEn,
      nameKn,
      unit,
      level: stockLevel(quantity, lowStockThreshold),
    })),
    upcomingBooking: demoBookings(now).upcoming[0]!,
    unreadNotifications: 2,
  };
}

// Shop: today's queue, appointments, attendance ------------------------------------

function entry(n: number, status: QueueEntry["status"], minutesAgo: number, now: Date, kind: QueueEntry["kind"], note: string | null = null): QueueEntry {
  const checkedIn = now.getTime() - minutesAgo * 60_000;
  return {
    id: fakeId("c100", n),
    number: n,
    status,
    kind,
    note,
    bookingCode: kind === "booking" ? formatBookingCode(codeOf(n)) : null,
    slotStartsAt: kind === "booking" ? new Date(checkedIn + 10 * 60_000).toISOString() : null,
    checkedInAt: new Date(checkedIn).toISOString(),
    calledAt: status === "waiting" ? null : new Date(checkedIn + 6 * 60_000).toISOString(),
    finishedAt: status === "served" || status === "no_show" ? new Date(checkedIn + 11 * 60_000).toISOString() : null,
  };
}

function appointment(n: number, status: BookingStatus, startsAt: string, queueNumber: number | null = null): ShopAppointment {
  return {
    id: fakeId("b200", n),
    code: formatBookingCode(codeOf(100 + n)),
    status,
    slotId: fakeId("a100", n),
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600_000).toISOString(),
    cardNumber: `•••••••••${String(100 + n).slice(-2)}`,
    memberCount: 1 + (n % 6),
    checkedInAt: queueNumber ? new Date(Date.parse(startsAt) + 5 * 60_000).toISOString() : null,
    queueNumber,
  };
}

export function demoShopQueue(now: Date): ShopQueue {
  const entries = [
    entry(1, "served", 70, now, "booking"),
    entry(2, "served", 62, now, "walk_in", "Assisted by staff"),
    entry(3, "no_show", 55, now, "booking"),
    entry(4, "serving", 20, now, "booking"),
    entry(5, "waiting", 14, now, "walk_in", "Elderly, needs a chair"),
    entry(6, "waiting", 6, now, "booking"),
  ];
  const later = new Date(Math.ceil((now.getTime() + 1) / 3600_000) * 3600_000).toISOString();
  const waiting = entries.filter((e) => e.status === "waiting");
  const served = entries.filter((e) => e.status === "served" && e.calledAt && e.finishedAt);
  return {
    date: istDate(now),
    nowServing: entries.find((e) => e.status === "serving") ?? null,
    waiting,
    finished: entries.filter((e) => e.status === "served" || e.status === "no_show").reverse(),
    expected: [appointment(1, "booked", later), appointment(2, "booked", later), appointment(3, "booked", later)],
    estimate: estimateWait(
      served.map((e) => (Date.parse(e.finishedAt!) - Date.parse(e.calledAt!)) / 1000),
      waiting.length + 1,
    ),
  };
}

export function demoShopHistory(now: Date): ShopAppointment[] {
  const today = istDate(now);
  const statuses: BookingStatus[] = ["checked_in", "checked_in", "no_show", "checked_in", "cancelled", "checked_in", "checked_in"];
  return Array.from({ length: 24 }, (_, i) => {
    const date = addDays(today, -1 - Math.floor(i / 4));
    const status = statuses[i % statuses.length]!;
    return appointment(10 + i, status, at(date, HOURS[i % 4]!), status === "checked_in" ? 1 + (i % 9) : null);
  });
}

export function demoAttendance(now: Date): AttendanceSummary {
  const history = demoShopHistory(now);
  const queue = demoShopQueue(now);
  const visits = [queue.nowServing, ...queue.waiting, ...queue.finished].filter((e) => e !== null);
  const served = visits.filter((e) => e.status === "served");
  return {
    days: 30,
    booked: history.length,
    attended: history.filter((a) => a.status === "checked_in").length,
    notAttended: history.filter((a) => a.status === "no_show").length,
    cancelled: history.filter((a) => a.status === "cancelled").length,
    walkIns: visits.filter((e) => e.kind === "walk_in").length,
    served: served.length,
    calledNotPresent: visits.filter((e) => e.status === "no_show").length,
    medianServiceMinutes: queue.estimate.status === "estimate" ? queue.estimate.minutes : null,
    serviceSamples: served.length,
  };
}
