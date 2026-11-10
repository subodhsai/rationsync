import { KARNATAKA_DISTRICTS, type ShopRegistrationSummary, type WarehouseOption } from "@rationsync/shared";
import Link from "next/link";
import { SelectField } from "@/components/field";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RegistrationFilters } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type District = (typeof KARNATAKA_DISTRICTS)[number];

/** Reads filters from the URL, accepting only known districts and the caller's own warehouses. */
export function parseShopFilters(
  params: Record<string, string | string[] | undefined>,
  warehouses: WarehouseOption[],
  status: RegistrationFilters["status"],
): RegistrationFilters {
  const district = KARNATAKA_DISTRICTS.find((d) => d === params.district) as District | undefined;
  const warehouseId = warehouses.find((w) => w.id === params.warehouseId)?.id;
  return { status, district, warehouseId };
}

export function ShopFilters({
  action,
  filters,
  warehouses,
  keep = {},
}: {
  action: string;
  filters: RegistrationFilters;
  warehouses: WarehouseOption[];
  keep?: Record<string, string>;
}) {
  const active = Boolean(filters.district || filters.warehouseId);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="w-52">
        <SelectField id="district" label="District" defaultValue={filters.district ?? ""}>
          <option value="">All districts</option>
          {KARNATAKA_DISTRICTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
      </div>
      {warehouses.length > 1 && (
        <div className="w-64">
          <SelectField id="warehouseId" label="Warehouse" defaultValue={filters.warehouseId ?? ""}>
            <option value="">All my warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      <Button type="submit" variant="outline">
        Apply
      </Button>
      {active && (
        <Link
          href={`${action}${keep.status ? `?status=${keep.status}` : ""}`}
          className="inline-flex min-h-10 items-center text-[0.9375rem] text-muted-foreground underline-offset-4 hover:underline"
        >
          Clear filters
        </Link>
      )}
    </form>
  );
}

/** Applications or directory rows; each shop name opens its detail page. */
export function ShopTable({
  rows,
  emptyTitle,
  variant,
}: {
  rows: ShopRegistrationSummary[];
  emptyTitle: string;
  variant: "applications" | "directory";
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} />;
  const directory = variant === "directory";
  const alerts = (n: number) => (
    <span className={cn("tabular-nums", n > 0 ? "font-medium text-warning" : "text-muted-foreground")}>
      {n === 0 ? "None" : `${n} open`}
    </span>
  );

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/warehouse/shops/${r.id}`} className="block space-y-1 p-4 transition-colors duration-150 hover:bg-muted/50">
              <p className="font-medium text-primary">{r.name}</p>
              <p className="font-mono text-[0.8125rem] text-muted-foreground">{r.fpsId}</p>
              <p className="text-[0.875rem] text-muted-foreground">
                {r.taluk}, {r.district} ·{" "}
                {directory ? <>Alerts: {alerts(r.openAlerts)}</> : `submitted ${formatDateTime(r.submittedAt)}`}
              </p>
            </Link>
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
              <TableHead>Warehouse</TableHead>
              <TableHead className="pr-4">{directory ? "Low-stock alerts" : "Submitted"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="py-3 pl-4">
                  <Link href={`/warehouse/shops/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-[0.875rem]">{r.fpsId}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.taluk}, {r.district}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.warehouseName}</TableCell>
                <TableCell className="pr-4 text-muted-foreground tabular-nums">
                  {directory ? alerts(r.openAlerts) : formatDateTime(r.submittedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
