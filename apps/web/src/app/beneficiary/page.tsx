import { Bell, ChevronRight, MapPin, Phone, QrCode, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { StockLevelLabel } from "@/components/status";
import { buttonVariants } from "@/components/ui/button";
import { AutoRefresh } from "@/components/visit-forms";
import { QueuePanel } from "@/components/visit-lists";
import { getBeneficiaryOverview } from "@/lib/data";
import { formatDate, formatTimeRange, formatWeekdayDate } from "@/lib/format";
import { beneficiaryText } from "@/lib/messages";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Your ration shop" };

export default function BeneficiaryHomePage({ searchParams }: PageProps<"/beneficiary">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: Pick<PageProps<"/beneficiary">, "searchParams">) {
  const session = await requireRole("beneficiary");
  const [{ card, shop, stock, upcomingBooking: next, unreadNotifications }, query] = await Promise.all([
    getBeneficiaryOverview(session),
    searchParams,
  ]);

  if (!card || !shop) {
    return (
      <>
        <PageHeader title="Link your ration card" meta="Then you can see your shop, what it has in stock, and book a collection time." />
        <Link href="/beneficiary/link-card" className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })}>
          Link demo card
        </Link>
        <p className="text-[0.9375rem] text-muted-foreground">{beneficiaryText.en.demoCard}</p>
        <p className="text-[0.9375rem] text-muted-foreground">{beneficiaryText.en.walkInPromise}</p>
      </>
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
      {query.linked && (
        <p role="status" className="rounded-lg border border-primary/25 bg-primary-tint px-4 py-3 text-[0.9375rem] text-primary">
          Demo card linked.
        </p>
      )}

      {next?.queue ? (
        <>
          <QueuePanel queue={next.queue} />
          <AutoRefresh seconds={15} />
          <p className="text-[0.8125rem] text-muted-foreground">Updates every 15 seconds while this page is open.</p>
        </>
      ) : (
        <section aria-labelledby="visit" className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 id="visit" className="text-[0.9375rem] font-medium text-muted-foreground">
            Next collection visit
          </h2>
          {next ? (
            <>
              <p className="mt-1 text-xl font-semibold">{formatWeekdayDate(next.startsAt)}</p>
              <p className="text-[0.9375rem] tabular-nums">{formatTimeRange(next.startsAt, next.endsAt)}</p>
              <Link href={`/beneficiary/visits/${next.id}`} className={buttonVariants({ size: "lg", className: "mt-4 w-full sm:w-auto" })}>
                <QrCode className="size-5" aria-hidden="true" />
                Show booking QR code
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1 text-[0.9375rem]">No visit booked.</p>
              <Link href="/beneficiary/book" className={buttonVariants({ size: "lg", className: "mt-4 w-full sm:w-auto" })}>
                Book a collection time
              </Link>
            </>
          )}
          <p className="mt-3 text-[0.875rem] text-muted-foreground">{beneficiaryText.en.walkInPromise}</p>
        </section>
      )}

      {unreadNotifications > 0 && (
        <Link
          href="/beneficiary/notifications"
          className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors duration-150 hover:bg-muted/50"
        >
          <Bell className="size-5 text-primary" aria-hidden="true" />
          <span className="flex-1 font-medium">
            {unreadNotifications} new {unreadNotifications === 1 ? "notification" : "notifications"}
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      )}

      <section aria-labelledby="availability" className="space-y-3">
        <h2 id="availability" className="text-lg font-semibold">
          Available at your shop
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {stock.map((item) => (
            <li key={item.commodityCode} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5">
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
          What the shop has now, not your entitlement. Booking a time does not reserve stock.
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
              <a href={`tel:${shop.contactPhone.replace(/\s/g, "")}`} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
                {shop.contactPhone}
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="card" className="space-y-1 text-[0.875rem] text-muted-foreground">
        <h2 id="card" className="text-[0.9375rem] font-medium text-foreground">
          Demo card linked
        </h2>
        <p>
          Card <span className="font-mono">{card.cardNumber}</span> · {card.category} · {card.memberCount}{" "}
          {card.memberCount === 1 ? "member" : "members"} · linked {formatDate(card.linkedAt)}
        </p>
        <p>Matched against fictional demo records. This is not government verification.</p>
        <Link href="/beneficiary/profile" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
          Your profile and language
        </Link>
      </section>
    </>
  );
}
