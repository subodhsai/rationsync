import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationList } from "@/components/notification-list";
import { PageHeader, PageSkeleton } from "@/components/page";
import { requireApprovedShop } from "@/lib/session";
import { getNotifications } from "@/lib/supply-data";

export const metadata: Metadata = { title: "Notifications" };

export default function ShopNotificationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Notifications />
    </Suspense>
  );
}

async function Notifications() {
  const session = await requireApprovedShop();
  const { items, unread } = await getNotifications(session);
  return (
    <>
      <PageHeader title="Notifications" meta={unread ? `${unread} unread` : "All caught up"} />
      <NotificationList items={items} unread={unread} preview={session.mode === "demo"} />
    </>
  );
}
