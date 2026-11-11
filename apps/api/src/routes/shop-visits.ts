import {
  checkInSchema,
  estimateWait,
  publishSlotsSchema,
  scheduleSchema,
  slotStatusSchema,
  walkInSchema,
  type AttendanceSummary,
  type ScheduleWindow,
  type ShopQueue,
  type ShopSlot,
} from "@rationsync/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { actorOf, requireApprovedShop } from "../auth.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { loadAppointments, loadQueueEntries, serviceDurations } from "../visit-queries.js";

const isoDate = z.iso.date();
const slotsQuery = z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(1).max(31).default(14) });
const appointmentsQuery = z.union([
  z.object({ date: isoDate }),
  z.object({ scope: z.literal("history"), page: z.coerce.number().int().min(1).max(1000).default(1) }),
]);
const finishSchema = z.object({ outcome: z.enum(["served", "no_show"]) });

// Appointments and the visit queue. Attendance only: nothing here records distribution or
// changes stock, and checking in is not e-POS authentication.
export function shopVisitsRouter(db: Db): Router {
  const router = Router();
  router.use(requireApprovedShop);
  const shopIdOf = (req: Request) => actorOf(req).shop!.id;
  const actor = (req: Request) => actorOf(req).id;
  const idParam = (req: Request, notFound: string) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, notFound, "Not found at your shop.");
    return id.data;
  };

  async function todaysQueue(shopId: string): Promise<ShopQueue> {
    const { rows } = await db.query<{ today: string }>("select public.today_ist()::text as today");
    const today = rows[0]!.today;
    const [entries, expected, durations] = await Promise.all([
      loadQueueEntries(db, "q.shop_id = $1 and q.service_date = $2::date", [shopId, today]),
      loadAppointments(
        db,
        `s.shop_id = $1 and b.status = 'booked'
           and s.starts_at >= ($2::date)::timestamp at time zone 'Asia/Kolkata'
           and s.starts_at < ($2::date + 1)::timestamp at time zone 'Asia/Kolkata'`,
        [shopId, today],
        "order by s.starts_at, b.created_at",
      ),
      serviceDurations(db, shopId),
    ]);
    const waiting = entries.filter((e) => e.status === "waiting");
    const nowServing = entries.find((e) => e.status === "serving") ?? null;
    return {
      date: today,
      nowServing,
      waiting,
      finished: entries.filter((e) => e.status === "served" || e.status === "no_show").reverse(),
      expected,
      // Time for everyone currently waiting to be seen.
      estimate: estimateWait(durations, waiting.length + (nowServing ? 1 : 0)),
    };
  }

  // Schedule and slots ------------------------------------------------------------

  router.get("/booking-schedule", async (req, res) => {
    const { rows } = await db.query<ScheduleWindow>(
      `select weekday, to_char(start_time, 'HH24:MI') as "startTime", to_char(end_time, 'HH24:MI') as "endTime",
              slot_minutes as "slotMinutes", capacity, walk_in_reserve as "walkInReserve"
         from public.shop_booking_schedule where shop_id = $1 order by weekday, start_time`,
      [shopIdOf(req)],
    );
    res.json({ windows: rows });
  });

  router.post("/booking-schedule", async (req, res) => {
    const { windows } = scheduleSchema.parse(req.body);
    await db.query("select public.save_booking_schedule($1, $2)", [actor(req), JSON.stringify(windows)]);
    res.json({ windows });
  });

  router.post("/slots/publish", async (req, res) => {
    const { days } = publishSlotsSchema.parse(req.body);
    const { rows } = await db.query<{ created: number }>("select public.publish_slots($1, $2) as created", [actor(req), days]);
    res.json({ created: rows[0]!.created });
  });

  router.get("/slots", async (req, res) => {
    const { from, days } = slotsQuery.parse(req.query);
    const { rows } = await db.query<ShopSlot>(
      `select s.id, s.starts_at as "startsAt", s.ends_at as "endsAt", s.capacity, s.walk_in_reserve as "walkInReserve",
              s.booked_count as booked, greatest(s.capacity - s.walk_in_reserve - s.booked_count, 0) as remaining,
              s.status, s.status_reason as "statusReason",
              (select count(*)::int from public.bookings b where b.slot_id = s.id and b.status = 'checked_in') as "checkedIn",
              (select count(*)::int from public.bookings b where b.slot_id = s.id and b.status = 'no_show') as "notAttended"
         from public.appointment_slots s
        where s.shop_id = $1
          and s.starts_at >= (coalesce($2::date, public.today_ist()))::timestamp at time zone 'Asia/Kolkata'
          and s.starts_at < (coalesce($2::date, public.today_ist()) + $3::int)::timestamp at time zone 'Asia/Kolkata'
        order by s.starts_at`,
      [shopIdOf(req), from ?? null, days],
    );
    res.json({ items: rows });
  });

  router.post("/slots/:id/status", async (req, res) => {
    const id = idParam(req, "slot_not_found");
    const { status, reason } = slotStatusSchema.parse(req.body);
    await db.query("select public.set_slot_status($1, $2, $3, $4)", [id, actor(req), status, reason ?? null]);
    res.json({ ok: true });
  });

  // Appointments --------------------------------------------------------------------

  router.get("/appointments", async (req, res) => {
    const query = appointmentsQuery.parse(req.query);
    const shopId = shopIdOf(req);
    if ("date" in query) {
      res.json({
        items: await loadAppointments(
          db,
          `s.shop_id = $1 and s.starts_at >= ($2::date)::timestamp at time zone 'Asia/Kolkata'
             and s.starts_at < ($2::date + 1)::timestamp at time zone 'Asia/Kolkata'`,
          [shopId, query.date],
          "order by s.starts_at, b.created_at",
        ),
      });
      return;
    }
    const items = await loadAppointments(
      db,
      "s.shop_id = $1 and s.starts_at < now()",
      [shopId, 26, (query.page - 1) * 25],
      "order by s.starts_at desc, b.created_at desc limit $2 offset $3",
    );
    res.json({ items: items.slice(0, 25), page: query.page, hasMore: items.length > 25 });
  });

  router.post("/bookings/:id/no-show", async (req, res) => {
    await db.query("select public.mark_booking_no_show($1, $2)", [idParam(req, "booking_not_found"), actor(req)]);
    res.json({ ok: true });
  });

  // Check-in and queue -----------------------------------------------------------------

  // A repeated scan answers with the existing queue entry, flagged, instead of a second one.
  router.post("/check-ins", async (req, res) => {
    const input = checkInSchema.parse(req.body);
    const { rows } = await db.query<{ result: { entryId: string; alreadyCheckedIn: boolean } }>(
      "select public.check_in_booking($1, $2, $3) as result",
      [actor(req), "token" in input ? input.token : null, "code" in input ? input.code : null],
    );
    const { entryId, alreadyCheckedIn } = rows[0]!.result;
    const [entry] = await loadQueueEntries(db, "q.id = $1", [entryId]);
    res.status(alreadyCheckedIn ? 200 : 201).json({ alreadyCheckedIn, entry });
  });

  router.get("/queue", async (req, res) => {
    res.json({ queue: await todaysQueue(shopIdOf(req)) });
  });

  router.post("/queue/walk-ins", async (req, res) => {
    const { note } = walkInSchema.parse(req.body);
    const { rows } = await db.query<{ id: string }>("select (public.register_walk_in($1, $2)).id as id", [actor(req), note ?? null]);
    const [entry] = await loadQueueEntries(db, "q.id = $1", [rows[0]!.id]);
    res.status(201).json({ entry });
  });

  router.post("/queue/call-next", async (req, res) => {
    const { rows } = await db.query<{ id: string }>("select (public.call_next_in_queue($1)).id as id", [actor(req)]);
    const [entry] = await loadQueueEntries(db, "q.id = $1", [rows[0]!.id]);
    res.json({ entry });
  });

  router.post("/queue/:id/finish", async (req, res) => {
    const id = idParam(req, "queue_entry_not_found");
    const { outcome } = finishSchema.parse(req.body);
    await db.query("select public.finish_queue_entry($1, $2, $3)", [id, actor(req), outcome]);
    const [entry] = await loadQueueEntries(db, "q.id = $1", [id]);
    res.json({ entry });
  });

  // Attendance over the last 30 days, counted from bookings and queue entries.
  router.get("/attendance", async (req, res) => {
    const shopId = shopIdOf(req);
    const { rows } = await db.query<Omit<AttendanceSummary, "medianServiceMinutes" | "serviceSamples" | "days">>(
      `select count(*) filter (where b.id is not null)::int as booked,
              count(*) filter (where b.status = 'checked_in')::int as attended,
              count(*) filter (where b.status = 'no_show')::int as "notAttended",
              count(*) filter (where b.status = 'cancelled')::int as cancelled,
              (select count(*)::int from public.queue_entries q where q.shop_id = $1 and q.booking_id is null
                  and q.checked_in_at > now() - interval '30 days') as "walkIns",
              (select count(*)::int from public.queue_entries q where q.shop_id = $1 and q.status = 'served'
                  and q.checked_in_at > now() - interval '30 days') as served,
              (select count(*)::int from public.queue_entries q where q.shop_id = $1 and q.status = 'no_show'
                  and q.checked_in_at > now() - interval '30 days') as "calledNotPresent"
         from public.appointment_slots s
         left join public.bookings b on b.slot_id = s.id
        where s.shop_id = $1 and s.starts_at > now() - interval '30 days' and s.starts_at <= now()`,
      [shopId],
    );
    const durations = await serviceDurations(db, shopId);
    const estimate = estimateWait(durations, 1);
    const summary: AttendanceSummary = {
      days: 30,
      ...rows[0]!,
      medianServiceMinutes: estimate.status === "estimate" ? estimate.minutes : null,
      serviceSamples: durations.length,
    };
    res.json({ summary });
  });

  return router;
}
