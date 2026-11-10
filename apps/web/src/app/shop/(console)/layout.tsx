import { AppShell } from "@/components/app-shell";

export default function ShopConsoleLayout({ children }: LayoutProps<"/shop">) {
  return <AppShell area="shop">{children}</AppShell>;
}
