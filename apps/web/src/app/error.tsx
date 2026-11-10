"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-lg space-y-4 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-[-0.01em]">This page could not be loaded</h1>
      <p className="text-[0.9375rem] text-muted-foreground">
        The RationSync API may be unavailable or still starting up. Nothing was changed. Try again in a moment.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
