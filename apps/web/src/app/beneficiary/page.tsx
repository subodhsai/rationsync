import { CalendarClock, MapPin, Phone, Store } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { StockLevelLabel } from "@/components/status";
import { getBeneficiaryOverview } from "@/lib/data";
import { formatTimeRange, formatWeekdayDate } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Your ration shop" };

export default function BeneficiaryHomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const session = await requireRole("beneficiary");
  const { card, shop, stock, upcomingBooking } = await getBeneficiaryOverview(session);

  if (!card || !shop) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Link your ration card</h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          Once a card is linked you will see your shop, what it has in stock, and collection times. Card linking uses
          fictional demo cards and is not available yet in this prototype build.
        </p>
      </section>
    );
  }

  return (
    <>
      <PageHeader
        title={shop.name}
        meta={
          <>
            Your ration shop · <span className="font-mono text-[0.875rem]">{shop.fpsId}</span>
          </>
        }
      />

      <section aria-labelledby="visit" className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 id="visit" className="flex items-center gap-2 text-[0.9375rem] font-medium text-muted-foreground">
          <CalendarClock className="size-[18px]" aria-hidden="true" />
          Next collection visit
        </h2>
        {upcomingBooking ? (
          <div className="mt-2">
            <p className="text-xl font-semibold">{formatWeekdayDate(upcomingBooking.startsAt)}</p>
            <p className="text-[0.9375rem] tabular-nums">
              {formatTimeRange(upcomingBooking.startsAt, upcomingBooking.endsAt)}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[0.9375rem]">No collection time booked.</p>
        )}
        <p className="mt-3 text-[0.875rem] text-muted-foreground">
          Booking is optional. You can also walk in during shop hours.
        </p>
      </section>

      <section aria-labelledby="availability" className="space-y-3">
        <h2 id="availability" className="text-lg font-semibold">
          Availability at your shop
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {stock.map((item) => (
            <li key={item.commodityCode} className="flex items-center justify-between gap-3 px-4 py-3">
              <p>
                <span className="font-medium">{item.nameEn}</span>{" "}
                <span lang="kn" className="text-[0.875rem] text-muted-foreground">
                  {item.nameKn}
                </span>
              </p>
              <StockLevelLabel level={item.level} />
            </li>
          ))}
        </ul>
        <p className="text-[0.875rem] text-muted-foreground">
          This shows what the shop has, not your entitlement. Entitlement depends on your card category and household
          size.
        </p>
      </section>

      <section aria-labelledby="shop-details" className="space-y-3">
        <h2 id="shop-details" className="text-lg font-semibold">
          Shop details
        </h2>
        <dl className="divide-y divide-border rounded-lg border border-border bg-card text-[0.9375rem]">
          <div className="flex gap-3 px-4 py-3">
            <dt>
              <MapPin className="mt-0.5 size-[18px] text-muted-foreground" aria-label="Address" />
            </dt>
            <dd>{shop.address}</dd>
          </div>
          <div className="flex gap-3 px-4 py-3">
            <dt>
              <Store className="mt-0.5 size-[18px] text-muted-foreground" aria-label="Opening hours" />
            </dt>
            <dd>{shop.openingHours}</dd>
          </div>
          <div className="flex items-center gap-3 px-4 py-1.5">
            <dt>
              <Phone className="size-[18px] text-muted-foreground" aria-label="Phone" />
            </dt>
            <dd>
              <a
                href={`tel:${shop.contactPhone.replace(/\s/g, "")}`}
                className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
              >
                {shop.contactPhone}
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <p className="text-[0.875rem] text-muted-foreground">
        Ration card <span className="font-mono">{card.cardNumber}</span> · {card.category} · {card.memberCount}{" "}
        {card.memberCount === 1 ? "member" : "members"}
      </p>
    </>
  );
}
