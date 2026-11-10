import { stockLevel, type BeneficiaryOverview, type CardCategory } from "@rationsync/shared";
import { Router } from "express";
import { actorOf, requireRole } from "../auth.js";
import type { Db } from "../db.js";

// Even fictional card numbers are shown masked, the way a real one would have to be.
export function maskCardNumber(cardNumber: string): string {
  return cardNumber.length <= 4 ? cardNumber : `${"•".repeat(cardNumber.length - 2)}${cardNumber.slice(-2)}`;
}

interface LinkRow {
  card_number: string;
  category: CardCategory;
  member_count: number;
  shop_id: string;
  fps_id: string;
  name: string;
  address: string;
  opening_hours: string;
  contact_phone: string;
}

export function beneficiaryRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("beneficiary"));

  router.get("/overview", async (req, res) => {
    const userId = actorOf(req).id;
    const { rows } = await db.query<LinkRow>(
      `select rc.card_number, rc.category, rc.member_count,
              s.id as shop_id, s.fps_id, s.name, s.address, s.opening_hours, s.contact_phone
         from public.beneficiary_cards bc
         join public.demo_ration_cards rc on rc.id = bc.card_id
         join public.shops s on s.id = rc.shop_id
        where bc.user_id = $1`,
      [userId],
    );
    const link = rows[0];
    if (!link) {
      const empty: BeneficiaryOverview = { card: null, shop: null, stock: [], upcomingBooking: null };
      res.json(empty);
      return;
    }

    const [stock, booking] = await Promise.all([
      db.query<{ commodityCode: string; nameEn: string; nameKn: string; unit: string; quantity: number; threshold: number }>(
        `select c.code as "commodityCode", c.name_en as "nameEn", c.name_kn as "nameKn", c.unit,
                i.quantity::float8 as quantity, i.low_stock_threshold::float8 as threshold
           from public.shop_inventory i
           join public.commodities c on c.code = i.commodity_code
          where i.shop_id = $1
          order by c.sort_order`,
        [link.shop_id],
      ),
      db.query<NonNullable<BeneficiaryOverview["upcomingBooking"]>>(
        `select b.id, s.starts_at as "startsAt", s.ends_at as "endsAt", b.status
           from public.bookings b
           join public.appointment_slots s on s.id = b.slot_id
          where b.beneficiary_id = $1 and b.status = 'booked' and s.ends_at > now()
          order by s.starts_at
          limit 1`,
        [userId],
      ),
    ]);

    const overview: BeneficiaryOverview = {
      card: { cardNumber: maskCardNumber(link.card_number), category: link.category, memberCount: link.member_count },
      shop: {
        fpsId: link.fps_id,
        name: link.name,
        address: link.address,
        openingHours: link.opening_hours,
        contactPhone: link.contact_phone,
      },
      // Beneficiaries see availability, not the shop's exact ledger balance.
      stock: stock.rows.map(({ quantity, threshold, ...c }) => ({ ...c, level: stockLevel(quantity, threshold) })),
      upcomingBooking: booking.rows[0] ?? null,
    };
    res.json(overview);
  });

  return router;
}
