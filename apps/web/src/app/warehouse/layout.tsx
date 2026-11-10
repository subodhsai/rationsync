import { Suspense } from "react";
import { AppShell, ShellFallback } from "@/components/app-shell";
import { requireRole } from "@/lib/session";

async function WarehouseGate({ children }: { children: React.ReactNode }) {
  await requireRole("warehouse_admin");
  return <AppShell area="warehouse">{children}</AppShell>;
}

export default function WarehouseLayout({ children }: LayoutProps<"/warehouse">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <WarehouseGate>{children}</WarehouseGate>
    </Suspense>
  );
}
