import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-lg space-y-4 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-[-0.01em]">Page not found</h1>
      <p className="text-[0.9375rem] text-muted-foreground">The address may be mistyped, or the page may have moved.</p>
      <Button asChild variant="outline">
        <Link href="/">Go to the start page</Link>
      </Button>
    </main>
  );
}
