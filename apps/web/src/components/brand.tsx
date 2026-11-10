import Link from "next/link";
import { cn } from "@/lib/utils";

/** A stock register: three ruled lines in a square. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect width="24" height="24" rx="5" className="fill-primary" />
      <path d="M6.5 8h11M6.5 12h11M6.5 16h6" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex min-h-11 items-center gap-2 rounded-md text-[1.0625rem] font-semibold", className)}
    >
      <BrandMark />
      RationSync
    </Link>
  );
}
