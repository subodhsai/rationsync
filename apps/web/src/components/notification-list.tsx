import type { AppNotification } from "@rationsync/shared";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { markNotificationsRead } from "@/lib/supply-actions";
import { cn } from "@/lib/utils";

/** In-app notifications, newest first. Unread ones carry a visible "New" label as well as a marker. */
export function NotificationList({ items, unread, preview }: { items: AppNotification[]; unread: number; preview: boolean }) {
  if (items.length === 0) return <EmptyState title="No notifications yet">Requests, decisions, shipments and low stock appear here.</EmptyState>;
  return (
    <div className="space-y-3">
      {unread > 0 && !preview && (
        <form action={markNotificationsRead} className="flex justify-end">
          <Button type="submit" variant="outline">
            Mark all as read
          </Button>
        </form>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {items.map((n) => (
          <li key={n.id} className={cn("relative space-y-0.5 p-4 pl-5", !n.readAt && "bg-primary-tint/30")}>
            {!n.readAt && <span aria-hidden="true" className="absolute top-4 bottom-4 left-0 w-0.5 rounded-full bg-primary" />}
            <p className="font-medium">
              {!n.readAt && <span className="mr-2 text-[0.8125rem] font-medium text-primary">New</span>}
              {n.title}
            </p>
            {n.body && <p className="text-[0.9375rem]">{n.body}</p>}
            <p className="text-[0.8125rem] text-muted-foreground tabular-nums">{formatDateTime(n.createdAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
