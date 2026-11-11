import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BackLink, PageHeader, PageSkeleton, Panel } from "@/components/page";
import { CardLinkForm } from "@/components/visit-forms";
import { getBeneficiaryOverview } from "@/lib/data";
import { beneficiaryText } from "@/lib/messages";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Link demo card" };

export default function LinkCardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LinkCard />
    </Suspense>
  );
}

async function LinkCard() {
  const session = await requireRole("beneficiary");
  if ((await getBeneficiaryOverview(session)).card) redirect("/beneficiary");
  return (
    <>
      <div className="space-y-2">
        <BackLink href="/beneficiary">Home</BackLink>
        <PageHeader title="Link your demo card" meta="Enter the details printed on the demo card." />
      </div>
      <Panel title="Card details">
        <CardLinkForm />
      </Panel>
      <div className="space-y-2 text-[0.875rem] text-muted-foreground">
        <p>{beneficiaryText.en.demoCard}</p>
        <p>Never enter an Aadhaar number. After five wrong attempts, linking pauses for an hour.</p>
        {session.mode === "demo" && <p>Preview: try DEMO-000101 with head of family &quot;Demo household 101&quot;.</p>}
      </div>
    </>
  );
}
