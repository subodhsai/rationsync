import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink, PageHeader, PageSkeleton, Panel } from "@/components/page";
import { RequestForm } from "@/components/supply-forms";
import { getCommodities } from "@/lib/data";
import { requireApprovedShop } from "@/lib/session";
import { getSuggestions } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Request stock" };

export default function NewRequestPage({ searchParams }: PageProps<"/shop/requests/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewRequest searchParams={searchParams} />
    </Suspense>
  );
}

async function NewRequest({ searchParams }: Pick<PageProps<"/shop/requests/new">, "searchParams">) {
  const session = await requireApprovedShop();
  const [commodities, suggestions, params] = await Promise.all([getCommodities(session), getSuggestions(session), searchParams]);

  return (
    <>
      <div className="space-y-2">
        <BackLink href="/shop/requests">Requests</BackLink>
        <PageHeader title="Request stock" meta="Sent to the warehouse that supplies your shop." />
      </div>
      <div className="max-w-2xl">
        <Panel title="Request details">
          <RequestForm
            commodities={commodities}
            suggestions={suggestions}
            initialCode={typeof params.commodity === "string" ? params.commodity : undefined}
          />
        </Panel>
      </div>
    </>
  );
}
