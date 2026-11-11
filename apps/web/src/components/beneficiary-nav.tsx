"use client";

import { CalendarDays, CalendarPlus, House, LifeBuoy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { beneficiaryText } from "@/lib/messages";
import { cn } from "@/lib/utils";

const items = [
  { href: "/beneficiary", label: beneficiaryText.en.nav.home, icon: House },
  { href: "/beneficiary/book", label: beneficiaryText.en.nav.book, icon: CalendarPlus },
  { href: "/beneficiary/visits", label: beneficiaryText.en.nav.visits, icon: CalendarDays },
  { href: "/beneficiary/help", label: beneficiaryText.en.nav.help, icon: LifeBuoy },
];

const isActive = (pathname: string, href: string) =>
  href === "/beneficiary" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

/** Four destinations: a bottom tab bar on phones, a row of links on wider screens. */
export function BeneficiaryNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] sm:static sm:border-t-0 sm:border-b sm:pb-0">
      <ul className="mx-auto grid max-w-3xl grid-cols-4 sm:flex sm:gap-1 sm:px-4">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.8125rem] transition-colors duration-150 sm:min-h-11 sm:flex-row sm:gap-2 sm:rounded-md sm:px-3 sm:text-[0.9375rem]",
                  active ? "font-medium text-primary sm:bg-primary-tint" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5 sm:size-[18px]" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
