import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BackLink, PageHeader, PageSkeleton } from "@/components/page";
import { RegistrationForm } from "@/components/registration-form";
import { getApplication, getRegistrationWarehouses } from "@/lib/data";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Apply to join" };

export default function RegisterShopPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Register />
    </Suspense>
  );
}

async function Register() {
  const session = await requireRole("shop_admin");
  const [application, warehouses] = await Promise.all([getApplication(session), getRegistrationWarehouses(session)]);
  // Only a first application or a rejected one can be (re)submitted.
  if (application && application.status !== "rejected") redirect("/shop/status");

  return (
    <>
      {application && <BackLink href="/shop/status">Application status</BackLink>}
      <PageHeader
        title={application ? "Correct and resubmit" : "Apply to join RationSync"}
        meta="A warehouse administrator checks these details before your shop can use inventory tools."
      />
      {application?.reviewReason && (
        <div className="rounded-lg border border-destructive/30 bg-destructive-tint px-4 py-3 text-[0.9375rem]">
          <p className="font-medium text-destructive">Reason given</p>
          <p className="mt-0.5">{application.reviewReason}</p>
        </div>
      )}
      <RegistrationForm warehouses={warehouses} defaults={application} />
    </>
  );
}
