import Link from "next/link";
import { cn } from "@/lib/utils";

/** A segmented row of links; the current option carries aria-current. */
export function FilterTabs({
  label,
  options,
}: {
  label: string;
  options: Array<{ href: string; label: string; current: boolean }>;
}) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-card p-1">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          aria-current={o.current ? "page" : undefined}
          className={cn(
            "flex h-9 shrink-0 items-center rounded-md px-3.5 text-[0.9375rem] transition-colors duration-150",
            o.current ? "bg-primary-tint font-medium text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
