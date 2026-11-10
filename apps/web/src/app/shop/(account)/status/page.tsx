import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ApplicationDetails, DecisionHistory, DocumentList } from "@/components/application-details";
import { DocumentUploader } from "@/components/document-uploader";
import { PageSkeleton, Panel } from "@/components/page";
import { ShopStatusLabel } from "@/components/status";
import { Button } from "@/components/ui/button";
import { getApplication } from "@/lib/data";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Application status" };

// Outside the console shell on purpose: no shop tools are shown before approval.
export default function ShopStatusPage({ searchParams }: PageProps<"/shop/status">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Status searchParams={searchParams} />
    </Suspense>
  );
}

const steps = [
  "Submit your shop's FPS ID, address and supplying warehouse.",
  "An administrator at that warehouse reviews the application and records a reason.",
  "Once approved, inventory, alerts and bookings unlock for your shop.",
];

async function Status({ searchParams }: Pick<PageProps<"/shop/status">, "searchParams">) {
  const session = await requireRole("shop_admin");
  if (session.me.shop?.status === "approved") redirect("/shop");
  const application = await getApplication(session);
  const submitted = (await searchParams).submitted === "1";

  if (!application) {
    return (
      <section className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">Apply to join RationSync</h1>
          <p className="text-[0.9375rem] text-muted-foreground">
            Your account is a shop administrator account. Link it to your Fair Price Shop by applying.
          </p>
        </div>
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3 text-[0.9375rem]">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-tint text-[0.8125rem] font-semibold text-primary">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <Button asChild size="lg">
          <Link href="/shop/register">Start application</Link>
        </Button>
      </section>
    );
  }

  const pending = application.status === "pending";
  return (
    <div className="space-y-6">
      {submitted && pending && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary-tint px-3 py-2.5 text-primary">
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>Application submitted. The warehouse has been asked to review it.</p>
        </div>
      )}

      <header className="space-y-2">
        <ShopStatusLabel status={application.status} />
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">
          {pending ? "Your application is waiting for review" : "Your application was not approved"}
        </h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          {pending
            ? `An administrator at ${application.warehouse.name} reviews new shops. Inventory and alerts unlock after approval.`
            : "Read the reason below, correct the details, and resubmit. Your earlier decision stays on record."}
        </p>
      </header>

      {!pending && (
        <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive-tint px-4 py-3">
          <div className="text-[0.9375rem]">
            <p className="font-medium text-destructive">Reason given</p>
            <p className="mt-0.5">{application.reviewReason}</p>
          </div>
          <Button asChild>
            <Link href="/shop/register">Correct and resubmit</Link>
          </Button>
        </div>
      )}

      <Panel title="Application">
        <ApplicationDetails application={application} />
      </Panel>

      <Panel title="Supporting documents" description="Optional. Reviewers can open these; no one else can.">
        <div className="space-y-4">
          <DocumentList application={application} />
          {session.mode === "live" ? (
            <DocumentUploader userId={session.me.id} remaining={5 - application.documents.length} />
          ) : (
            <p className="text-[0.875rem] text-muted-foreground">
              Preview mode: uploads need Supabase Storage, so adding files is turned off.
            </p>
          )}
        </div>
      </Panel>

      {application.reviews.length > 0 && (
        <Panel title="Decision history">
          <DecisionHistory application={application} />
        </Panel>
      )}
    </div>
  );
}
