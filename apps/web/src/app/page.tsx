import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { InventoryTable } from "@/components/inventory-table";
import { PrototypeNotice } from "@/components/notices";
import { Button } from "@/components/ui/button";
import { startDemo } from "@/lib/actions";
import { isSupabaseConfigured } from "@/lib/env";
import { DEMO_PERSONAS, demoInventory, demoPersonaLabels } from "@/lib/fixtures";

const roles = [
  {
    title: "Households",
    points: [
      "Link a ration card (fictional cards in this prototype)",
      "See what your shop has in stock",
      "Book an optional collection time and show a QR token",
    ],
  },
  {
    title: "Shop administrators",
    points: [
      "Register a shop with its FPS ID for warehouse approval",
      "Record stock received and distributed, with reasons",
      "Request replenishment before stock runs low",
    ],
  },
  {
    title: "Warehouse administrators",
    points: [
      "Approve or reject shop registrations, with a recorded reason",
      "See low-stock alerts across assigned shops",
      "Dispatch shipments and track delivery",
    ],
  },
];

export default function Home() {
  return (
    <>
      <PrototypeNotice />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-2 sm:px-6">
          <Brand className="px-2" />
          {isSupabaseConfigured && (
            <Button asChild variant="ghost">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:py-20">
          <div className="space-y-6">
            <h1 className="text-[2.125rem] leading-[1.12] font-semibold tracking-[-0.02em] sm:text-[2.75rem]">
              Track ration stock from wholesale point to shop counter
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Shops record stock and request replenishment. Warehouses approve shops and dispatch supplies. Households
              check availability and book a time to collect.
            </p>
            {isSupabaseConfigured ? (
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/register">Create account</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/login">Sign in</Link>
                </Button>
              </div>
            ) : (
              <Button asChild size="lg">
                <a href="#preview">Preview with demo data</a>
              </Button>
            )}
          </div>

          <figure className="space-y-3">
            <div className="rounded-xl border border-border bg-background p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                <p className="font-medium">Demo FPS Kuvempunagar</p>
                <p className="font-mono text-[0.8125rem] text-muted-foreground">DEMO-FPS-MYS-0101</p>
              </div>
              <InventoryTable items={demoInventory} showUpdated={false} />
            </div>
            <figcaption className="text-[0.8125rem] text-muted-foreground">
              The shop inventory screen, shown with fictional demo data.
            </figcaption>
          </figure>
        </section>

        <section aria-labelledby="roles" className="border-t border-border py-12">
          <h2 id="roles" className="text-xl font-semibold">
            What each role can do
          </h2>
          <div className="mt-6 grid gap-8 md:grid-cols-3">
            {roles.map((role) => (
              <div key={role.title}>
                <h3 className="font-semibold">{role.title}</h3>
                <ul className="mt-3 space-y-2 text-[0.9375rem] text-muted-foreground">
                  {role.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2.5 h-px w-3 shrink-0 bg-primary" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-8 text-[0.9375rem]">
            Booking a collection time is optional. Households can always collect their ration by walking in during shop
            hours.
          </p>
        </section>

        {!isSupabaseConfigured && (
          <section id="preview" aria-labelledby="preview-title" className="scroll-mt-6 border-t border-border py-12">
            <h2 id="preview-title" className="text-xl font-semibold">
              Preview with demo data
            </h2>
            <p className="mt-2 max-w-2xl text-[0.9375rem] text-muted-foreground">
              Sign-in is off because Supabase is not configured for this deployment. Choose a role to explore the
              screens with fictional records. Nothing you see is a real person, shop or ration card.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {DEMO_PERSONAS.map((persona) => (
                <li key={persona}>
                  <form action={startDemo}>
                    <input type="hidden" name="persona" value={persona} />
                    <button
                      type="submit"
                      className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors duration-150 hover:border-primary/40 hover:bg-primary-tint/50"
                    >
                      <span>
                        <span className="block font-medium">{demoPersonaLabels[persona].title}</span>
                        <span className="block text-[0.875rem] text-muted-foreground">
                          {demoPersonaLabels[persona].detail}
                        </span>
                      </span>
                      <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-8 text-[0.8125rem] text-muted-foreground sm:px-6">
          RationSync is an independent educational prototype. It is not affiliated with the Government of Karnataka or
          its Department of Food, Civil Supplies and Consumer Affairs, and it does not connect to any government system.
        </p>
      </footer>
    </>
  );
}
