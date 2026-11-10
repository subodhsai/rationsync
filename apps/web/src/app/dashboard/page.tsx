import { ROLE_HOME } from "@rationsync/shared";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/session";

async function RoleRedirect(): Promise<null> {
  const session = await getSession();
  redirect(session ? ROLE_HOME[session.me.role] : "/login");
}

// Sends each person to their own area after sign-in.
export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted-foreground">Opening your dashboard</p>}>
      <RoleRedirect />
    </Suspense>
  );
}
