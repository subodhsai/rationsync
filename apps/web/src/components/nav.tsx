"use client";

import { BellRing, Boxes, ClipboardCheck, History, LayoutGrid, Menu, ScrollText, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type ConsoleArea = "shop" | "warehouse";

// Only pages that exist are listed. Later phases add their own entries here.
const navigation: Record<ConsoleArea, Array<{ href: string; label: string; icon: typeof Boxes }>> = {
  shop: [
    { href: "/shop", label: "Overview", icon: LayoutGrid },
    { href: "/shop/inventory", label: "Inventory", icon: Boxes },
    { href: "/shop/movements", label: "Stock movements", icon: ScrollText },
    { href: "/shop/alerts", label: "Low-stock alerts", icon: BellRing },
  ],
  warehouse: [
    { href: "/warehouse", label: "Applications", icon: ClipboardCheck },
    { href: "/warehouse/shops", label: "Shop directory", icon: Store },
    { href: "/warehouse/alerts", label: "Low stock", icon: BellRing },
    { href: "/warehouse/history", label: "Decisions", icon: History },
  ],
};

// Shop detail pages are reached from several lists, so they highlight none; their back link orients.
const isActive = (pathname: string, href: string, area: ConsoleArea) =>
  href === `/${area}` || href === "/warehouse/shops" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export function NavLinks({ area, onNavigate }: { area: ConsoleArea; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {navigation[area].map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href, area);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-2.5 rounded-md px-2.5 text-[0.9375rem] transition-colors duration-150",
                active
                  ? "bg-primary-tint font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileNav({ area, footer }: { area: ConsoleArea; footer: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 flex-col gap-0 p-3">
        <SheetHeader className="p-0">
          <SheetTitle asChild>
            <div>
              <Brand className="px-2" />
            </div>
          </SheetTitle>
        </SheetHeader>
        <nav aria-label="Main" className="mt-4">
          <NavLinks area={area} onNavigate={() => setOpen(false)} />
        </nav>
        <div className="mt-auto">{footer}</div>
      </SheetContent>
    </Sheet>
  );
}
