import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SelectField } from "@/components/field";
import { MovementList } from "@/components/movement-list";
import { PageHeader, PageSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getCommodities, getMovements } from "@/lib/data";
import { requireApprovedShop } from "@/lib/session";

export const metadata: Metadata = { title: "Stock movements" };

export default function MovementsPage({ searchParams }: PageProps<"/shop/movements">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Ledger searchParams={searchParams} />
    </Suspense>
  );
}

async function Ledger({ searchParams }: Pick<PageProps<"/shop/movements">, "searchParams">) {
  const session = await requireApprovedShop();
  const params = await searchParams;
  const commodity = typeof params.commodity === "string" ? params.commodity : undefined;
  const before = typeof params.before === "string" ? params.before : undefined;
  const [commodities, page] = await Promise.all([getCommodities(session), getMovements(session, { commodity, before })]);

  const olderHref = page.nextCursor
    ? `/shop/movements?${new URLSearchParams({ ...(commodity ? { commodity } : {}), before: page.nextCursor })}`
    : null;

  return (
    <>
      <PageHeader
        title="Stock movements"
        meta="Every change to this shop's stock, newest first. Entries cannot be edited or deleted."
      />
      <div className="space-y-4">
        <form className="flex flex-wrap items-end gap-3" action="/shop/movements">
          <div className="w-56">
            <SelectField id="commodity" label="Commodity" defaultValue={commodity ?? ""}>
              <option value="">All commodities</option>
              {commodities.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nameEn}
                </option>
              ))}
            </SelectField>
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
          {(commodity || before) && (
            <Link href="/shop/movements" className="inline-flex min-h-10 items-center text-[0.9375rem] text-muted-foreground underline-offset-4 hover:underline">
              Back to newest
            </Link>
          )}
        </form>

        <MovementList items={page.items} />

        {olderHref && (
          <Button asChild variant="outline">
            <Link href={olderHref}>Older entries</Link>
          </Button>
        )}
      </div>
    </>
  );
}
