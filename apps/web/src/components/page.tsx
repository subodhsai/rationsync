import { ArrowRight, ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PageHeader({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] sm:text-[1.75rem]">{title}</h1>
        {meta && <div className="text-[0.9375rem] text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-[0.9375rem] text-muted-foreground">{children}</div>}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** A titled section on a plain surface. */
export function Panel({ title, description, children, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {description && <div className="mt-1 text-[0.9375rem] text-muted-foreground">{description}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 text-[0.9375rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {children}
    </Link>
  );
}

/** Label and value rows, for application details. */
export function DetailList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="divide-y divide-border text-[0.9375rem]">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionHeading({ id, title, href, linkLabel }: { id: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {href && (
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-1 text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline"
        >
          {linkLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/**
 * A row of counts, each worked out from records and optionally linking to the list behind it.
 * `attention` marks a count that needs action while it is above zero.
 */
export function StatRow({
  stats,
}: {
  stats: Array<{ label: string; value: number; href?: string; note?: string; attention?: boolean }>;
}) {
  return (
    // Rows always fill: 2 columns on phones, then 3 (six stats) or 2 (four), then one row on wide screens.
    <dl
      style={{ "--stats": stats.length } as React.CSSProperties}
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-[repeat(var(--stats),minmax(0,1fr))]",
        stats.length % 3 === 0 && "sm:grid-cols-3",
      )}
    >
      {stats.map((stat) => {
        const body = (
          <>
            <dt className="text-[0.8125rem] text-muted-foreground sm:text-[0.875rem]">{stat.label}</dt>
            <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", stat.attention && stat.value > 0 && "text-warning")}>
              {stat.value}
            </dd>
            {stat.note && <dd className="mt-0.5 text-[0.8125rem] text-muted-foreground">{stat.note}</dd>}
          </>
        );
        return stat.href ? (
          <Link key={stat.label} href={stat.href} className="bg-card px-4 py-4 transition-colors duration-150 hover:bg-muted/50 sm:px-5">
            {body}
          </Link>
        ) : (
          <div key={stat.label} className="bg-card px-4 py-4 sm:px-5">
            {body}
          </div>
        );
      })}
    </dl>
  );
}
