import { LogOut } from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { MobileNav, NavLinks, type ConsoleArea } from "@/components/nav";
import { DemoDataNotice, PrototypeNotice } from "@/components/notices";
import { PageSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut } from "@/lib/actions";
import { roleLabel } from "@/lib/format";
import { getSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const areaLabel: Record<ConsoleArea, string> = { shop: "Shop console", warehouse: "Warehouse console" };

async function AccountDetails() {
  const session = await getSession();
  if (!session) return null;
  const { me } = session;
  return (
    <div className="min-w-0 px-2.5 py-2">
      <p className="truncate text-[0.9375rem] font-medium">{me.fullName || "Signed in"}</p>
      <p className="truncate text-[0.8125rem] text-muted-foreground">
        {me.shop ? <span className="font-mono">{me.shop.fpsId}</span> : roleLabel[me.role]}
      </p>
    </div>
  );
}

function AccountFooter() {
  return (
    <div className="space-y-1 border-t border-border pt-3">
      <Suspense fallback={<Skeleton className="mx-2.5 h-10" />}>
        <AccountDetails />
      </Suspense>
      <form action={signOut}>
        <Button type="submit" variant="ghost" className="w-full justify-start px-2.5 text-muted-foreground">
          <LogOut className="size-[18px]" aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </div>
  );
}

/** Desktop sidebar and mobile drawer for the shop and warehouse consoles. */
export function AppShell({ area, children }: { area: ConsoleArea; children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-card px-3 py-4 lg:flex">
        <Brand className="px-2" />
        <p className="mt-1 px-2.5 text-[0.8125rem] text-muted-foreground">{areaLabel[area]}</p>
        <nav aria-label="Main" className="-mx-1 mt-6 min-h-0 flex-1 overflow-y-auto px-1">
          <NavLinks area={area} />
        </nav>
        <div className="mt-auto">
          <AccountFooter />
        </div>
      </aside>

      <div className="min-w-0">
        <PrototypeNotice />
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card px-2 lg:hidden">
          <Brand className="px-2" />
          <MobileNav area={area} footer={<AccountFooter />} />
        </header>
        <main id="main" className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <DemoDataNotice />
          {children}
        </main>
      </div>
    </div>
  );
}

/** Single-column layout for beneficiaries and account screens. */
export function SimpleShell({ children, signedIn = true, nav }: { children: ReactNode; signedIn?: boolean; nav?: ReactNode }) {
  return (
    <>
      <PrototypeNotice />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-2 sm:px-4">
          <Brand className="px-2" />
          {signedIn && (
            <form action={signOut}>
              <Button type="submit" variant="ghost" className="text-muted-foreground">
                <LogOut className="size-[18px]" aria-hidden="true" />
                Sign out
              </Button>
            </form>
          )}
        </div>
      </header>
      {nav}
      {/* Room at the bottom on phones for the fixed tab bar. */}
      <main id="main" className={cn("mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8", nav && "pb-28 sm:pb-8")}>
        <DemoDataNotice />
        {children}
      </main>
    </>
  );
}

/**
 * Neutral placeholder while a role layout authorises the session. It shows no role-specific
 * navigation, so a person never glimpses another role's area before being redirected.
 */
export function ShellFallback() {
  return (
    <>
      <PrototypeNotice />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-2 sm:px-6">
          <Brand className="px-2" />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        <PageSkeleton />
      </main>
    </>
  );
}
