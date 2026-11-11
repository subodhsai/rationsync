import { Suspense } from "react";
import { ShellFallback, SimpleShell } from "@/components/app-shell";
import { BeneficiaryNav } from "@/components/beneficiary-nav";
import { requireRole } from "@/lib/session";

async function BeneficiaryGate({ children }: { children: React.ReactNode }) {
  await requireRole("beneficiary");
  return <SimpleShell nav={<BeneficiaryNav />}>{children}</SimpleShell>;
}

export default function BeneficiaryLayout({ children }: LayoutProps<"/beneficiary">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <BeneficiaryGate>{children}</BeneficiaryGate>
    </Suspense>
  );
}
