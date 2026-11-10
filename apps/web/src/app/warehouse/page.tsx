import type { ShopStatus } from "@rationsync/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getShopRegistrations } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Shop registrations" };

const filters: Array<{ status: ShopStatus; label: string; empty: string }> = [
  { status: "pending", label: "Pending", empty: "No shops are waiting for review." },
  { status: "approved", label: "Approved", empty: "No approved shops under your warehouses yet." },
  { status: "rejected", label: "Rejected", empty: "No rejected registrations." },
];

export default function RegistrationsPage({ searchParams }: PageProps<"/warehouse">) {
  return (
    <>
      <PageHeader title="Shop registrations" meta="Fair Price Shops registered under the warehouses you manage" />
      <Suspense fallback={<PageSkeleton />}>
        <Registrations searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Registrations({ searchParams }: Pick<PageProps<"/warehouse">, "searchParams">) {
  const session = await requireRole("warehouse_admin");
  const requested = (await searchParams).status;
  const filter = filters.find((f) => f.status === requested) ?? filters[0]!;
  const rows = await getShopRegistrations(session, filter.status);

  return (
    <div className="space-y-4">
      <nav aria-label="Registration status" className="inline-flex rounded-lg border border-border bg-card p-1">
        {filters.map((f) => (
          <Link
            key={f.status}
            href={f.status === "pending" ? "/warehouse" : `/warehouse?status=${f.status}`}
            aria-current={f.status === filter.status ? "page" : undefined}
            className={cn(
              "flex h-9 items-center rounded-md px-3.5 text-[0.9375rem] transition-colors duration-150",
              f.status === filter.status
                ? "bg-primary-tint font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {filter.status === "pending" && rows.length > 0 && (
        <p className="text-[0.875rem] text-muted-foreground">
          Approve and reject actions are not available yet in this prototype build.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title={filter.empty} />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="space-y-2 p-4">
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="font-mono text-[0.8125rem] text-muted-foreground">{r.fpsId}</p>
                </div>
                <p className="text-[0.875rem] text-muted-foreground">
                  {r.taluk}, {r.district} · Submitted {formatDateTime(r.submittedAt)}
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden rounded-lg border border-border bg-card md:block">
            <Table className="text-[0.9375rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 pl-4">Shop</TableHead>
                  <TableHead>FPS ID</TableHead>
                  <TableHead>Taluk, district</TableHead>
                  <TableHead className="pr-4">Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-3 pl-4 font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-[0.875rem]">{r.fpsId}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.taluk}, {r.district}
                    </TableCell>
                    <TableCell className="pr-4 text-muted-foreground tabular-nums">
                      {formatDateTime(r.submittedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
