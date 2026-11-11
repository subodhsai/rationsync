import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterTabs } from "@/components/filter-tabs";
import { PageHeader, PageSkeleton } from "@/components/page";
import { BookingList } from "@/components/visit-lists";
import { requireRole } from "@/lib/session";
import { getMyBookings } from "@/lib/visit-data";

export const metadata: Metadata = { title: "Your visits" };

export default function VisitsPage({ searchParams }: PageProps<"/beneficiary/visits">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Visits searchParams={searchParams} />
    </Suspense>
  );
}

async function Visits({ searchParams }: Pick<PageProps<"/beneficiary/visits">, "searchParams">) {
  const session = await requireRole("beneficiary");
  const params = await searchParams;
  const scope = params.scope === "past" ? "past" : "upcoming";
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const { items, hasMore } = await getMyBookings(session, scope, page);

  return (
    <>
      <PageHeader title="Your visits" />
      <FilterTabs
        label="Visits"
        options={[
          { href: "/beneficiary/visits", label: "Upcoming", current: scope === "upcoming" },
          { href: "/beneficiary/visits?scope=past", label: "Past", current: scope === "past" },
        ]}
      />
      <BookingList items={items} emptyTitle={scope === "upcoming" ? "No visit booked" : "No past visits yet"}>
        {scope === "upcoming" && (
          <Link href="/beneficiary/book" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
            Book a collection time
          </Link>
        )}
      </BookingList>
      {(page > 1 || hasMore) && (
        <nav aria-label="Pages" className="flex justify-between text-[0.9375rem] font-medium">
          {page > 1 ? (
            <Link href={`/beneficiary/visits?scope=${scope}&page=${page - 1}`} className="inline-flex min-h-11 items-center text-primary">
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={`/beneficiary/visits?scope=${scope}&page=${page + 1}`} className="inline-flex min-h-11 items-center text-primary">
              Older
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
