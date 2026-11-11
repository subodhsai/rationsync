import { KARNATAKA_DISTRICTS, REQUEST_PRIORITIES, type RequestStatus } from "@rationsync/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Field, SelectField } from "@/components/field";
import { FilterTabs } from "@/components/filter-tabs";
import { PageHeader, PageSkeleton } from "@/components/page";
import { priorityLabel } from "@/components/status";
import { Pager, RequestTable } from "@/components/supply-lists";
import { Button } from "@/components/ui/button";
import { getCommodities } from "@/lib/data";
import { requireRole } from "@/lib/session";
import { getWarehouseRequests, type RequestFilters } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Requests" };

const tabs: Array<{ value: RequestStatus | "all"; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "partially_fulfilled", label: "Partially fulfilled" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];
const sorts = [
  ["recommended", "Recommended priority"],
  ["oldest", "Oldest first"],
  ["newest", "Newest first"],
] as const;

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, key: string) => (typeof p[key] === "string" ? (p[key] as string) : undefined);

function parse(p: Params, commodityCodes: string[]): RequestFilters {
  return {
    status: tabs.find((t) => t.value === p.status)?.value ?? "pending",
    priority: REQUEST_PRIORITIES.find((x) => x === p.priority),
    commodity: commodityCodes.find((c) => c === p.commodity),
    district: KARNATAKA_DISTRICTS.find((d) => d === p.district),
    q: one(p, "q")?.trim().slice(0, 60) || undefined,
    sort: sorts.find(([v]) => v === p.sort)?.[0] ?? "recommended",
    page: Math.max(1, Math.min(1000, Number.parseInt(one(p, "page") ?? "1", 10) || 1)),
  };
}

const href = (f: Partial<RequestFilters>) => {
  const query = new URLSearchParams(
    Object.entries(f).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== "" && !(e[0] === "page" && e[1] === 1))
      .map(([k, v]) => [k, String(v)]),
  );
  return `/warehouse/requests${query.size ? `?${query}` : ""}`;
};

export default function WarehouseRequestsPage({ searchParams }: PageProps<"/warehouse/requests">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

async function Requests({ searchParams }: Pick<PageProps<"/warehouse/requests">, "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const [params, commodities] = await Promise.all([searchParams, getCommodities(session)]);
  const filters = parse(params, commodities.map((c) => c.code));
  const result = await getWarehouseRequests(session, filters);
  const { page: _page, status, ...rest } = filters;
  const narrowed = Boolean(filters.priority || filters.commodity || filters.district || filters.q);

  return (
    <>
      <PageHeader title="Replenishment requests" meta="From shops your warehouses supply. Open one to check stock and decide." />
      <div className="space-y-4">
        <FilterTabs
          label="Request status"
          options={tabs.map((t) => ({ href: href({ ...rest, status: t.value === "pending" ? undefined : t.value } as Partial<RequestFilters>), label: t.label, current: t.value === status }))}
        />
        <form action="/warehouse/requests" className="flex flex-wrap items-end gap-3">
          {status !== "pending" && <input type="hidden" name="status" value={status} />}
          <div className="w-full sm:w-64">
            <Field id="q" label="Search" type="search" defaultValue={filters.q ?? ""} hint="Shop name, FPS ID or request number" />
          </div>
          <div className="w-[calc(50%-0.375rem)] sm:w-40">
            <SelectField id="priority" label="Stated priority" defaultValue={filters.priority ?? ""}>
              <option value="">Any</option>
              {REQUEST_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel[p]}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="w-[calc(50%-0.375rem)] sm:w-40">
            <SelectField id="commodity" label="Commodity" defaultValue={filters.commodity ?? ""}>
              <option value="">Any</option>
              {commodities.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nameEn}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="w-[calc(50%-0.375rem)] sm:w-48">
            <SelectField id="district" label="District" defaultValue={filters.district ?? ""}>
              <option value="">Any</option>
              {KARNATAKA_DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="w-[calc(50%-0.375rem)] sm:w-52">
            <SelectField id="sort" label="Order" defaultValue={filters.sort}>
              {sorts.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          </div>
          <Button type="submit" variant="outline">
            Apply
          </Button>
          {narrowed && (
            <Link href={href({ status: status === "pending" ? undefined : status } as Partial<RequestFilters>)} className="inline-flex min-h-10 items-center text-[0.9375rem] text-muted-foreground underline-offset-4 hover:underline">
              Clear filters
            </Link>
          )}
        </form>

        <RequestTable rows={result.items} variant="warehouse" emptyTitle={narrowed ? "No requests match these filters." : "No requests with this status."} />
        <Pager page={result.page} total={result.total} pageSize={result.pageSize} hrefFor={(page) => href({ ...filters, status: status === "pending" ? undefined : status, page } as Partial<RequestFilters>)} />
        {filters.sort === "recommended" && result.items.length > 0 && (
          <p className="text-[0.8125rem] text-muted-foreground">
            Recommended priority comes from each shop&apos;s current stock, its threshold and the last 30 days of distributions:
            urgent when out of stock or under 3 days of cover, high at half the threshold or under 7 days, normal at or below the
            threshold. It is a rule of thumb, not a prediction.
          </p>
        )}
      </div>
    </>
  );
}
