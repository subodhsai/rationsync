import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationList } from "@/components/notification-list";
import { BackLink, PageHeader, PageSkeleton } from "@/components/page";
import { requireRole } from "@/lib/session";
import { getNotifications } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Notifications" };

export default function BeneficiaryNotificationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Notifications />
    </Suspense>
  );
}

async function Notifications() {
  const session = await requireRole("beneficiary");
  const { items, unread } = await getNotifications(session);
  return (
    <>
      <div className="space-y-2">
        <BackLink href="/beneficiary">Home</BackLink>
        <PageHeader title="Notifications" meta={unread ? `${unread} unread` : "All caught up"} />
      </div>
      <NotificationList items={items} unread={unread} preview={session.mode === "demo"} />
      <p className="text-[0.875rem] text-muted-foreground">Shown in this app only. No SMS or email is sent.</p>
    </>
  );
}
