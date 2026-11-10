import { Suspense } from "react";
import { AppShell, ShellFallback } from "@/components/app-shell";
import { requireApprovedShop } from "@/lib/session";

async function ApprovedShopGate({ children }: { children: React.ReactNode }) {
  await requireApprovedShop();
  return <AppShell area="shop">{children}</AppShell>;
}

export default function ShopConsoleLayout({ children }: LayoutProps<"/shop">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <ApprovedShopGate>{children}</ApprovedShopGate>
    </Suspense>
  );
}
