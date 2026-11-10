import { AppShell } from "@/components/app-shell";

export default function WarehouseLayout({ children }: LayoutProps<"/warehouse">) {
  return <AppShell area="warehouse">{children}</AppShell>;
}
