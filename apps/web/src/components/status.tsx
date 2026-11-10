import type { AlertStatus, ShopStatus, StockLevel } from "@rationsync/shared";
import { CircleAlert, CircleCheck, CircleX, Clock } from "lucide-react";
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
