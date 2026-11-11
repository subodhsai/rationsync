import type {
  AlertStatus,
  BookingStatus,
  QueueStatus,
  RequestPriority,
  RequestStatus,
  ShipmentStatus,
  ShopStatus,
  SlotStatus,
  StockLevel,
} from "@rationsync/shared";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarCheck,
  Megaphone,
  Pause,
  UserX,
  ChevronsUp,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Minus,
  PackageCheck,
  PackageMinus,
  PackageOpen,
  TriangleAlert,
  Truck,
} from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

type Tone = "positive" | "warning" | "critical" | "neutral";

const tones: Record<Tone, string> = {
  positive: "bg-primary-tint text-primary",
  warning: "bg-warning-tint text-warning",
  critical: "bg-destructive-tint text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

// Every status pairs a word with an icon, so meaning never depends on colour alone.
function StatusLabel({ tone, icon: Icon, children }: { tone: Tone; icon: ComponentType<{ className?: string }>; children: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-[0.8125rem] font-medium whitespace-nowrap", tones[tone])}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

const stock: Record<StockLevel, { tone: Tone; icon: ComponentType<{ className?: string }>; label: string }> = {
  ok: { tone: "positive", icon: CircleCheck, label: "In stock" },
  low: { tone: "warning", icon: CircleAlert, label: "Low stock" },
  out: { tone: "critical", icon: CircleX, label: "Out of stock" },
};

export function StockLevelLabel({ level }: { level: StockLevel }) {
  const s = stock[level];
  return (
    <StatusLabel tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusLabel>
  );
}

const shop: Record<ShopStatus, { tone: Tone; icon: ComponentType<{ className?: string }>; label: string }> = {
  pending: { tone: "neutral", icon: Clock, label: "Pending review" },
  approved: { tone: "positive", icon: CircleCheck, label: "Approved" },
  rejected: { tone: "critical", icon: CircleX, label: "Rejected" },
};

export function ShopStatusLabel({ status }: { status: ShopStatus }) {
  const s = shop[status];
  return (
    <StatusLabel tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusLabel>
  );
}

export function AlertStatusLabel({ status }: { status: AlertStatus }) {
  return status === "open" ? (
    <StatusLabel tone="warning" icon={CircleAlert}>
      Open
    </StatusLabel>
  ) : (
    <StatusLabel tone="neutral" icon={CircleCheck}>
      Resolved
    </StatusLabel>
  );
}

type Spec = { tone: Tone; icon: ComponentType<{ className?: string }>; label: string };
const fromSpec = (s: Spec) => (
  <StatusLabel tone={s.tone} icon={s.icon}>
    {s.label}
  </StatusLabel>
);

const request: Record<RequestStatus, Spec> = {
  pending: { tone: "neutral", icon: Clock, label: "Pending" },
  approved: { tone: "positive", icon: CircleCheck, label: "Approved" },
  rejected: { tone: "critical", icon: CircleX, label: "Rejected" },
  partially_fulfilled: { tone: "warning", icon: PackageMinus, label: "Partially fulfilled" },
  fulfilled: { tone: "positive", icon: PackageCheck, label: "Fulfilled" },
  cancelled: { tone: "neutral", icon: Ban, label: "Cancelled" },
};
export const RequestStatusLabel = ({ status }: { status: RequestStatus }) => fromSpec(request[status]);

const shipment: Record<ShipmentStatus, Spec> = {
  preparing: { tone: "neutral", icon: PackageOpen, label: "Preparing" },
  dispatched: { tone: "neutral", icon: Truck, label: "Dispatched" },
  in_transit: { tone: "neutral", icon: Truck, label: "In transit" },
  delivered: { tone: "positive", icon: PackageCheck, label: "Delivered" },
  partially_received: { tone: "warning", icon: PackageMinus, label: "Partially received" },
  disputed: { tone: "critical", icon: TriangleAlert, label: "Disputed" },
  cancelled: { tone: "neutral", icon: Ban, label: "Cancelled" },
};
export const ShipmentStatusLabel = ({ status }: { status: ShipmentStatus }) => fromSpec(shipment[status]);

export const priorityLabel: Record<RequestPriority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const priority: Record<RequestPriority, Spec> = {
  urgent: { tone: "critical", icon: ChevronsUp, label: "Urgent" },
  high: { tone: "warning", icon: ArrowUp, label: "High" },
  normal: { tone: "neutral", icon: Minus, label: "Normal" },
  low: { tone: "neutral", icon: ArrowDown, label: "Low" },
};
export const PriorityLabel = ({ priority: p }: { priority: RequestPriority }) => fromSpec(priority[p]);

export const DiscrepancyLabel = ({ status }: { status: "open" | "resolved" }) =>
  fromSpec(status === "open" ? { tone: "warning", icon: CircleAlert, label: "Discrepancy open" } : { tone: "neutral", icon: CircleCheck, label: "Resolved" });

const booking: Record<BookingStatus, Spec> = {
  booked: { tone: "positive", icon: CalendarCheck, label: "Booked" },
  checked_in: { tone: "positive", icon: CircleCheck, label: "Checked in" },
  cancelled: { tone: "neutral", icon: Ban, label: "Cancelled" },
  no_show: { tone: "warning", icon: UserX, label: "Not checked in" },
};
export const BookingStatusLabel = ({ status }: { status: BookingStatus }) => fromSpec(booking[status]);

const queue: Record<QueueStatus, Spec> = {
  waiting: { tone: "neutral", icon: Clock, label: "Waiting" },
  serving: { tone: "positive", icon: Megaphone, label: "At the counter" },
  served: { tone: "neutral", icon: CircleCheck, label: "Visit completed" },
  no_show: { tone: "warning", icon: UserX, label: "Not present" },
};
export const QueueStatusLabel = ({ status }: { status: QueueStatus }) => fromSpec(queue[status]);

const slot: Record<SlotStatus, Spec> = {
  open: { tone: "positive", icon: CalendarCheck, label: "Taking bookings" },
  paused: { tone: "warning", icon: Pause, label: "Paused" },
  closed: { tone: "critical", icon: Ban, label: "Closed" },
};
export const SlotStatusLabel = ({ status }: { status: SlotStatus }) => fromSpec(slot[status]);
