import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { PrototypeNotice } from "@/components/notices";
import { Button } from "@/components/ui/button";

export function AuthFrame({ title, intro, footer, children }: { title: string; intro?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <>
      <PrototypeNotice />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-2 sm:px-6">
          <Brand className="px-2" />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[26rem] px-4 py-10 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">{title}</h1>
        {intro && <p className="mt-1 text-[0.9375rem] text-muted-foreground">{intro}</p>}
        <div className="mt-6">{children}</div>
        {footer && <p className="mt-6 text-[0.9375rem] text-muted-foreground">{footer}</p>}
      </main>
    </>
  );
}

export function AuthNotConfigured() {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <p className="font-medium">Sign-in is not set up on this deployment</p>
      <p className="text-[0.9375rem] text-muted-foreground">
        Accounts need a Supabase project. Until one is configured you can explore every role with fictional demo data.
      </p>
      <Button asChild>
        <Link href="/#preview">Preview with demo data</Link>
      </Button>
    </div>
  );
}
