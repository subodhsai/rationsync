import { Suspense } from "react";
import { ShellFallback, SimpleShell } from "@/components/app-shell";
import { requireRole } from "@/lib/session";

async function ShopAdminGate({ children }: { children: React.ReactNode }) {
  await requireRole("shop_admin");
  return <SimpleShell>{children}</SimpleShell>;
}

// Application screens for shop administrators who are not yet approved.
export default function ShopAccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <ShopAdminGate>{children}</ShopAdminGate>
    </Suspense>
  );
}
