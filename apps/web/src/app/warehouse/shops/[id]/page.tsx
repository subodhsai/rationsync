import type { ShopDetail } from "@rationsync/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AlertList } from "@/components/alert-list";
import { ApplicationDetails, DecisionHistory, DocumentList } from "@/components/application-details";
import { InventoryTable, StockRuleNote } from "@/components/inventory-table";
import { BackLink, EmptyState, PageSkeleton, Panel } from "@/components/page";
import { ReviewForm } from "@/components/review-form";
import { ShopStatusLabel } from "@/components/status";
import { getShopDetail } from "@/lib/data";
import { requireRole, type Session } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Shop" };

export default function ShopDetailPage({ params }: PageProps<"/warehouse/shops/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}

/** Short-lived links, created with the reviewer's own session; Storage policy limits them to their warehouses. */
async function documentLinks(session: Session, shop: ShopDetail): Promise<Record<string, string>> {
  if (session.mode === "demo" || shop.documents.length === 0) return {};
  const { data } = await (await createSupabaseServerClient()).storage
    .from("shop-documents")
    .createSignedUrls(shop.documents.map((d) => d.storagePath), 300);
  const byPath = new Map((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  return Object.fromEntries(shop.documents.flatMap((d) => (byPath.has(d.storagePath) ? [[d.id, byPath.get(d.storagePath)!]] : [])));
}

async function Detail({ params }: Pick<PageProps<"/warehouse/shops/[id]">, "params">) {
  const session = await requireRole("warehouse_admin");
  const { id } = await params;
  const shop = await getShopDetail(session, id);
  if (!shop) notFound();
  const links = await documentLinks(session, shop);
  const pending = shop.status === "pending";
  const openAlerts = shop.alerts.filter((a) => a.status === "open");

  return (
    <>
      <div className="space-y-2">
        <BackLink href={pending ? "/warehouse" : shop.status === "approved" ? "/warehouse/shops" : "/warehouse?status=rejected"}>
          {pending ? "Applications" : shop.status === "approved" ? "Shop directory" : "Rejected applications"}
        </BackLink>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] sm:text-[1.75rem]">{shop.name}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem] text-muted-foreground">
            <span className="font-mono text-[0.875rem]">{shop.fpsId}</span>
            <ShopStatusLabel status={shop.status} />
          </p>
        </div>
      </div>

      <div className={pending ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" : "space-y-6"}>
        <div className="space-y-6">
          <Panel title="Application">
            <ApplicationDetails application={shop} />
          </Panel>
          <Panel title="Supporting documents">
            <DocumentList application={shop} links={links} />
            {session.mode === "demo" && shop.documents.length > 0 && (
              <p className="mt-3 text-[0.875rem] text-muted-foreground">Preview mode: no files are stored, so names only.</p>
            )}
          </Panel>
        </div>

        {pending && (
          <div className="lg:sticky lg:top-6">
            <Panel title="Decision" description="Check the FPS ID and address against the licence before deciding.">
              <ReviewForm shopId={shop.id} shopName={shop.name} />
            </Panel>
          </div>
        )}
      </div>

      {shop.status === "approved" && (
        <>
          <section aria-labelledby="stock" className="space-y-3">
            <h2 id="stock" className="text-lg font-semibold">
              Stock on hand
            </h2>
            {shop.inventory.length === 0 ? (
              <EmptyState title="No stock recorded yet" />
            ) : (
              <>
                <InventoryTable items={shop.inventory} />
                <StockRuleNote />
              </>
            )}
          </section>
          <section aria-labelledby="shop-alerts" className="space-y-3">
            <h2 id="shop-alerts" className="text-lg font-semibold">
              Open low-stock alerts
            </h2>
            <AlertList items={openAlerts} showShop={false} linkTo={() => `/warehouse/shops/${shop.id}`} emptyTitle="No open alerts for this shop." />
          </section>
        </>
      )}

      <Panel title="Decision history">
        <DecisionHistory application={shop} />
      </Panel>
    </>
  );
}
