import {
  cardLinkSchema,
  profileSchema,
  slotChoiceSchema,
  stockLevel,
  type BeneficiaryOverview,
  type CardCategory,
  type CollectionSlot,
  type Language,
} from "@rationsync/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { actorOf, requireRole } from "../auth.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { loadBookings, maskCardNumber } from "../visit-queries.js";

export { maskCardNumber };

interface LinkRow {
  card_number: string;
  category: CardCategory;
  member_count: number;
  linked_at: string;
  shop_id: string;
  fps_id: string;
  name: string;
  address: string;
  opening_hours: string;
  contact_phone: string;
}

const bookingsQuery = z.object({
  scope: z.enum(["upcoming", "past"]).default("upcoming"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

// Upcoming: still bookable or checked in and waiting today. Everything else is history.
const upcomingSql = `((b.status = 'booked' and s.ends_at > now() - interval '1 hour')
  or (b.status = 'checked_in' and q.status in ('waiting', 'serving') and q.service_date = public.today_ist()))`;

export function beneficiaryRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("beneficiary"));
  const userOf = (req: Request) => actorOf(req).id;

  async function linkOf(userId: string): Promise<LinkRow | undefined> {
    const { rows } = await db.query<LinkRow>(
      `select rc.card_number, rc.category, rc.member_count, bc.linked_at,
              s.id as shop_id, s.fps_id, s.name, s.address, s.opening_hours, s.contact_phone
         from public.beneficiary_cards bc
         join public.demo_ration_cards rc on rc.id = bc.card_id
         join public.shops s on s.id = rc.shop_id
        where bc.user_id = $1`,
      [userId],
    );
    return rows[0];
  }
  const ownBookingId = (req: Request) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "booking_not_found", "No such booking.");
    return id.data;
  };
  async function ownBooking(req: Request, id: string, withToken = false) {
    const [booking] = await loadBookings(db, "b.id = $1 and b.beneficiary_id = $2", [id, userOf(req)], "", { withToken });
    if (!booking) throw new HttpError(404, "booking_not_found", "No such booking.");
    return booking;
  }

  router.get("/overview", async (req, res) => {
    const userId = userOf(req);
    await db.query("select public.expire_past_bookings($1), public.send_booking_reminders($1)", [userId]);
    const [link, unread] = await Promise.all([
      linkOf(userId),
      db.query<{ n: number }>("select count(*)::int as n from public.notifications where user_id = $1 and read_at is null", [userId]),
    ]);
    const unreadNotifications = unread.rows[0]!.n;
    if (!link) {
      const empty: BeneficiaryOverview = { card: null, shop: null, stock: [], upcomingBooking: null, unreadNotifications };
      res.json(empty);
      return;
    }

    const [stock, upcoming] = await Promise.all([
      db.query<{ commodityCode: string; nameEn: string; nameKn: string; unit: string; quantity: number; threshold: number }>(
        `select c.code as "commodityCode", c.name_en as "nameEn", c.name_kn as "nameKn", c.unit,
                i.quantity::float8 as quantity, i.low_stock_threshold::float8 as threshold
           from public.shop_inventory i
           join public.commodities c on c.code = i.commodity_code
          where i.shop_id = $1
          order by c.sort_order`,
        [link.shop_id],
      ),
      loadBookings(db, `b.beneficiary_id = $1 and ${upcomingSql}`, [userId], "order by s.starts_at limit 1"),
    ]);

    const overview: BeneficiaryOverview = {
      card: {
        cardNumber: maskCardNumber(link.card_number),
        category: link.category,
        memberCount: link.member_count,
        linkedAt: link.linked_at,
      },
      shop: {
        fpsId: link.fps_id,
        name: link.name,
        address: link.address,
        openingHours: link.opening_hours,
        contactPhone: link.contact_phone,
      },
      // Households see availability, not the shop's exact ledger balance.
      stock: stock.rows.map(({ quantity, threshold, ...c }) => ({ ...c, level: stockLevel(quantity, threshold) })),
      upcomingBooking: upcoming[0] ?? null,
      unreadNotifications,
    };
    res.json(overview);
  });

  router.get("/profile", async (req, res) => {
    const { rows } = await db.query<{ fullName: string; preferredLanguage: Language }>(
      `select full_name as "fullName", preferred_language as "preferredLanguage" from public.profiles where id = $1`,
      [userOf(req)],
    );
    res.json({ profile: rows[0] });
  });

  // Only the name and language can change here; the role is never writable by its owner.
  router.patch("/profile", async (req, res) => {
    const input = profileSchema.parse(req.body);
    const { rows } = await db.query<{ fullName: string; preferredLanguage: Language }>(
      `update public.profiles set full_name = $2, preferred_language = $3 where id = $1
       returning full_name as "fullName", preferred_language as "preferredLanguage"`,
      [userOf(req), input.fullName, input.preferredLanguage],
    );
    res.json({ profile: rows[0] });
  });

  // Matching against fictional demo records only. Failures are counted per account and
  // limited in the database; every failure gets the same answer.
  router.post("/card-link", async (req, res) => {
    const input = cardLinkSchema.parse(req.body);
    const userId = userOf(req);
    const { rows } = await db.query<{ user_id: string | null }>(
      "select (public.link_demo_card($1, $2, $3)).user_id as user_id",
      [userId, input.cardNumber, input.headOfFamily],
    );
    if (!rows[0]?.user_id) {
      throw new HttpError(422, "card_not_verified", "No demo card matches those details.");
    }
    const link = (await linkOf(userId))!;
    res.status(201).json({
      card: { cardNumber: maskCardNumber(link.card_number), category: link.category, memberCount: link.member_count, linkedAt: link.linked_at },
      shop: { fpsId: link.fps_id, name: link.name },
    });
  });

  // Open and paused slots for the next seven days at the linked shop. Closed ones are hidden.
  router.get("/slots", async (req, res) => {
    const link = await linkOf(userOf(req));
    if (!link) throw new HttpError(409, "card_not_linked", "Link your demo ration card before booking.");
    const { rows } = await db.query<CollectionSlot>(
      `select id, starts_at as "startsAt", ends_at as "endsAt", capacity, walk_in_reserve as "walkInReserve",
              booked_count as booked, greatest(capacity - walk_in_reserve - booked_count, 0) as remaining,
              status, status_reason as "statusReason"
         from public.appointment_slots
        where shop_id = $1 and status <> 'closed' and starts_at > now()
          and starts_at < (public.today_ist() + 8)::timestamp at time zone 'Asia/Kolkata'
        order by starts_at`,
      [link.shop_id],
    );
    res.json({ items: rows });
  });

  router.get("/bookings", async (req, res) => {
    const { scope, page } = bookingsQuery.parse(req.query);
    const userId = userOf(req);
    await db.query("select public.expire_past_bookings($1)", [userId]);
    const where = `b.beneficiary_id = $1 and ${scope === "upcoming" ? upcomingSql : `not ${upcomingSql}`}`;
    const items = await loadBookings(
      db,
      where,
      [userId, 21, (page - 1) * 20],
      `order by s.starts_at ${scope === "upcoming" ? "asc" : "desc"} limit $2 offset $3`,
    );
    res.json({ items: items.slice(0, 20), page, hasMore: items.length > 20 });
  });

  router.get("/bookings/:id", async (req, res) => {
    res.json({ booking: await ownBooking(req, ownBookingId(req), true) });
  });

  // book_slot is idempotent for the same slot, so a repeated tap returns the same booking.
  router.post("/bookings", async (req, res) => {
    const { slotId } = slotChoiceSchema.parse(req.body);
    const { rows } = await db.query<{ id: string }>("select (public.book_slot($1, $2)).id as id", [slotId, userOf(req)]);
    res.status(201).json({ booking: await ownBooking(req, rows[0]!.id, true) });
  });

  router.post("/bookings/:id/cancel", async (req, res) => {
    const id = ownBookingId(req);
    await ownBooking(req, id); // someone else's booking answers 404, not "no longer active"
    await db.query("select public.cancel_booking($1, $2)", [id, userOf(req)]);
    res.json({ booking: await ownBooking(req, id) });
  });

  router.post("/bookings/:id/reschedule", async (req, res) => {
    const id = ownBookingId(req);
    await ownBooking(req, id);
    const { slotId } = slotChoiceSchema.parse(req.body);
    const { rows } = await db.query<{ id: string }>("select (public.reschedule_booking($1, $2, $3)).id as id", [id, userOf(req), slotId]);
    res.json({ booking: await ownBooking(req, rows[0]!.id, true) });
  });

  return router;
}
