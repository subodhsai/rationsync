import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { getBeneficiaryOverview } from "@/lib/data";
import { beneficiaryText } from "@/lib/messages";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Help" };

const questions: Array<[string, string]> = [
  ["Do I have to book?", beneficiaryText.en.walkInPromise],
  [
    "What happens at the shop?",
    "Show your booking QR code or read out the booking code. The shop checks you in and gives you a queue number, which appears in this app. You are then served at the counter as usual.",
  ],
  ["Does checking in give me my rations?", beneficiaryText.en.checkInNote],
  [
    "I cannot come at my time",
    "Move the booking to another time, or cancel it, from Visits. If you miss it, you can still walk in.",
  ],
  [
    "Does a booking reserve stock for me?",
    "No. The home page shows what the shop has now. Entitlement is decided by the Public Distribution System, not by this app.",
  ],
  ["About the demo card", beneficiaryText.en.demoCard],
  [
    "Is this an official service?",
    "No. RationSync is an educational prototype, not a Government of Karnataka service. Do not enter real ration-card or Aadhaar numbers.",
  ],
];

export default function HelpPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Help />
    </Suspense>
  );
}

async function Help() {
  const session = await requireRole("beneficiary");
  const { shop } = await getBeneficiaryOverview(session);
  return (
    <>
      <PageHeader title="Help" />
      {shop && (
        <section aria-labelledby="ask" className="rounded-lg border border-border bg-card p-4">
          <h2 id="ask" className="font-semibold">
            Ask your shop
          </h2>
          <p className="mt-1 text-[0.9375rem]">
            {shop.name}, {shop.openingHours}.
          </p>
          <a href={`tel:${shop.contactPhone.replace(/\s/g, "")}`} className="mt-1 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
            Call {shop.contactPhone}
          </a>
        </section>
      )}
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {questions.map(([q, a]) => (
          <details key={q} className="group">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 font-medium">{q}</summary>
            <p className="px-4 pb-4 text-[0.9375rem] text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </>
  );
}
