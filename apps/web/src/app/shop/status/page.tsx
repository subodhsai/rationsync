import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SimpleShell } from "@/components/app-shell";
import { PageSkeleton } from "@/components/page";
import { ShopStatusLabel } from "@/components/status";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Registration status" };

// Deliberately outside the console shell: no shop tools are shown before approval.
export default function ShopStatusPage() {
  return (
    <SimpleShell>
      <Suspense fallback={<PageSkeleton />}>
        <Status />
      </Suspense>
    </SimpleShell>
  );
}

async function Status() {
  const { me } = await requireRole("shop_admin");
  if (me.shop?.status === "approved") redirect("/shop");

  if (!me.shop) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Register your shop</h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          Your account is set up as a shop administrator. The registration form, where you enter your FPS ID, address
          and supplying warehouse, is not available yet in this prototype build.
        </p>
      </section>
    );
  }

  const { shop } = me;
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">
          {shop.status === "pending" ? "Your registration is waiting for review" : "Your registration was not approved"}
        </h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          {shop.status === "pending"
            ? "A warehouse administrator for your area reviews each new shop. Inventory, requests and bookings unlock after approval."
            : "The reviewing warehouse administrator recorded the reason below. Shop tools stay locked."}
        </p>
      </div>

      <dl className="divide-y divide-border rounded-lg border border-border bg-card text-[0.9375rem]">
        <div className="flex flex-wrap justify-between gap-2 px-4 py-3">
          <dt className="text-muted-foreground">Shop</dt>
          <dd className="font-medium">{shop.name}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2 px-4 py-3">
          <dt className="text-muted-foreground">FPS ID</dt>
          <dd className="font-mono">{shop.fpsId}</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <ShopStatusLabel status={shop.status} />
          </dd>
        </div>
        {shop.reviewReason && (
          <div className="space-y-1 px-4 py-3">
            <dt className="text-muted-foreground">Reason</dt>
            <dd>{shop.reviewReason}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
