"use client";

import { SLOT_LENGTHS, type CollectionSlot, type Language, type ScheduleWindow } from "@rationsync/shared";
import { Camera, Loader2, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Field, SelectField } from "@/components/field";
import { FormStatus, useFormAction } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { formatShortDay, formatTime, formatTimeRange, formatWeekdayDate, istDateKey } from "@/lib/format";
import { bookSlot, checkIn, linkCard, publishSlots, registerWalkIn, rescheduleBooking, saveSchedule, updateProfile } from "@/lib/visit-actions";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function Submit({ pending, children, className, variant }: { pending: boolean; children: ReactNode; className?: string; variant?: "default" | "outline" }) {
  return (
    <Button type="submit" size="lg" disabled={pending} variant={variant} className={className}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </Button>
  );
}

/** Re-reads server data while the page is visible, so status changes appear without a reload. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}

/** One-tap action with its result shown in place. For frequent, reversible-by-process steps. */
export function ActionButton({ action, label, variant = "outline", className }: { action: (prev: ActionState) => Promise<ActionState>; label: string; variant?: "default" | "outline" | "ghost"; className?: string }) {
  const { state, onSubmit, pending } = useFormAction(action as Action);
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Button type="submit" variant={variant} disabled={pending} className={cn("min-h-11", className)}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {label}
      </Button>
      <FormStatus state={state} />
    </form>
  );
}

// Household ---------------------------------------------------------------------

export function CardLinkForm() {
  const { state, onSubmit, pending, errorFor } = useFormAction(linkCard);
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormStatus state={state} />
      <Field
        id="cardNumber"
        label="Demo card number"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="max-w-60 font-mono uppercase"
        hint="Printed on the demo card, like DEMO-000101"
        error={errorFor("cardNumber")}
      />
      <Field
        id="headOfFamily"
        label="Head of family"
        autoComplete="off"
        hint="As printed on the demo card"
        error={errorFor("headOfFamily")}
      />
      <Submit pending={pending} className="w-full sm:w-auto">
        Link card
      </Submit>
    </form>
  );
}

export function ProfileForm({ fullName, preferredLanguage }: { fullName: string; preferredLanguage: Language }) {
  const { state, onSubmit, pending, errorFor } = useFormAction(updateProfile);
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormStatus state={state} />
      <Field id="fullName" label="Your name" defaultValue={fullName} autoComplete="name" error={errorFor("fullName")} />
      <SelectField
        id="preferredLanguage"
        label="Language"
        defaultValue={preferredLanguage}
        hint="Kannada screens are being prepared. Your choice is saved for when they are ready."
      >
        <option value="en">English</option>
        <option value="kn">ಕನ್ನಡ (Kannada)</option>
      </SelectField>
      <Submit pending={pending} variant="outline">
        Save
      </Submit>
    </form>
  );
}

const placesLeft = (s: CollectionSlot) =>
  s.status === "paused" ? "Not taking bookings" : s.remaining === 0 ? "Full" : `${s.remaining} ${s.remaining === 1 ? "place" : "places"} left`;

/**
 * Pick a day, then a time, then confirm. Full and paused times stay visible but cannot be
 * chosen. Rescheduling uses the same picker and moves the existing booking in one step.
 */
export function SlotPicker({ slots, reschedule }: { slots: CollectionSlot[]; reschedule?: { bookingId: string; currentStartsAt: string } }) {
  const action = reschedule ? rescheduleBooking.bind(null, reschedule.bookingId) : bookSlot;
  const { state, onSubmit, pending } = useFormAction(action);
  const days = [...new Set(slots.map((s) => istDateKey(s.startsAt)))];
  const firstOpenDay = days.find((d) => slots.some((s) => istDateKey(s.startsAt) === d && s.status === "open" && s.remaining > 0)) ?? days[0];
  const [day, setDay] = useState(firstOpenDay);
  const [slotId, setSlotId] = useState<string | null>(null);
  const chosen = slots.find((s) => s.id === slotId);

  if (state.status === "preview" || state.status === "success") return <FormStatus state={state} />;
  if (slots.length === 0) {
    return <p className="text-[0.9375rem] text-muted-foreground">No collection times are open in the next seven days. You can walk in during shop hours.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6 pb-24 sm:pb-0">
      <FormStatus state={state} />
      <input type="hidden" name="slotId" value={slotId ?? ""} />

      {/* min-w-0: a fieldset otherwise grows to fit its widest child and the row cannot scroll. */}
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-[0.9375rem] font-medium">Day</legend>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:px-0">
          {days.map((d) => {
            const daySlots = slots.filter((s) => istDateKey(s.startsAt) === d);
            const open = daySlots.reduce((n, s) => n + (s.status === "open" ? s.remaining : 0), 0);
            return (
              // relative: keeps the visually hidden radio inside the scrolling row instead of widening the page.
              <label
                key={d}
                className="relative flex min-h-14 min-w-24 shrink-0 cursor-pointer flex-col justify-center rounded-lg border border-border bg-card px-3 py-2 has-checked:border-primary has-checked:bg-primary-tint has-focus-visible:outline-2 has-focus-visible:outline-ring"
              >
                <input type="radio" name="day" value={d} checked={day === d} onChange={() => { setDay(d); setSlotId(null); }} className="sr-only" />
                <span className="font-medium">{formatShortDay(daySlots[0]!.startsAt)}</span>
                <span className="text-[0.8125rem] text-muted-foreground tabular-nums">{open ? `${open} places` : "Full"}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[0.9375rem] font-medium">Time</legend>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {slots
            .filter((s) => istDateKey(s.startsAt) === day)
            .map((s) => {
              const disabled = s.status !== "open" || s.remaining === 0;
              const current = reschedule && s.startsAt === reschedule.currentStartsAt;
              return (
                <li key={s.id}>
                  <label className={cn("flex min-h-14 items-center gap-3 px-4 py-2", disabled || current ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer has-checked:bg-primary-tint/60")}>
                    <input
                      type="radio"
                      name="slotChoice"
                      value={s.id}
                      disabled={disabled || Boolean(current)}
                      checked={slotId === s.id}
                      onChange={() => setSlotId(s.id)}
                      className="size-5 accent-primary"
                    />
                    <span className="flex-1 font-medium tabular-nums">{formatTimeRange(s.startsAt, s.endsAt)}</span>
                    <span className={cn("text-[0.875rem] tabular-nums", !disabled && s.remaining <= 3 && "text-warning")}>
                      {current ? "Your current time" : placesLeft(s)}
                    </span>
                  </label>
                </li>
              );
            })}
        </ul>
        <p className="text-[0.8125rem] text-muted-foreground">Some places in every time are kept for people who walk in.</p>
      </fieldset>

      {/* Fixed above the tab bar on phones, so the confirm button is always within reach. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-border bg-card px-4 py-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Submit pending={pending} className="w-full sm:w-auto" variant="default">
          {chosen
            ? `${reschedule ? "Move to" : "Book"} ${formatShortDay(chosen.startsAt)}, ${formatTime(chosen.startsAt)}`
            : "Choose a time"}
        </Submit>
      </div>
      {chosen && <p className="sr-only" role="status">{`Selected ${formatWeekdayDate(chosen.startsAt)}, ${formatTimeRange(chosen.startsAt, chosen.endsAt)}`}</p>}
    </form>
  );
}

// Shop: check-in ----------------------------------------------------------------------

const noSubscribe = () => () => {};

type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => Detector;
  }
}

/**
 * Scan a booking QR code with the camera where the browser supports it, or type the code.
 * Both paths submit the same field; the API decides validity, shop and duplicates.
 */
export function CheckInPanel() {
  const { state, onSubmit, pending, errorFor } = useFormAction(checkIn);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  // Unknown during server rendering; decided in the browser without a second render pass.
  const supported = useSyncExternalStore(noSubscribe, () => "BarcodeDetector" in window, () => null);
  useEffect(() => {
    if (state.status !== "idle" && input.current) input.current.value = "";
  }, [state]);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | undefined;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current || stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector!({ formats: ["qr_code"] });
        while (!stopped) {
          const [code] = await detector.detect(video.current);
          if (code?.rawValue && input.current) {
            input.current.value = code.rawValue;
            setScanning(false);
            form.current?.requestSubmit();
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setCameraError("The camera could not be opened. Allow camera access, or type the code below.");
        setScanning(false);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]);

  return (
    <div className="space-y-4">
      {scanning ? (
        <div className="space-y-2">
          <video ref={video} muted playsInline className="aspect-square w-full max-w-sm rounded-lg bg-foreground object-cover" aria-label="Camera view for scanning" />
          <Button type="button" variant="outline" onClick={() => setScanning(false)} className="min-h-11">
            <X className="size-4" aria-hidden="true" />
            Stop scanning
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Button type="button" size="lg" disabled={!supported} onClick={() => { setCameraError(undefined); setScanning(true); }} className="w-full sm:w-auto">
            <Camera className="size-5" aria-hidden="true" />
            Scan QR code
          </Button>
          {supported === false && (
            <p className="text-[0.875rem] text-muted-foreground">This browser cannot scan codes. Type the booking code instead.</p>
          )}
          {cameraError && <p className="text-[0.875rem] text-destructive">{cameraError}</p>}
        </div>
      )}

      <form ref={form} onSubmit={onSubmit} noValidate className="space-y-3">
        <FormStatus state={state} />
        <Field
          ref={input}
          id="value"
          label="Booking code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="max-w-60 font-mono uppercase"
          hint="10 letters and digits shown under the household's QR code, like 4F2A-9C1B-7D"
          error={errorFor("value")}
        />
        <Submit pending={pending}>Check in</Submit>
      </form>
    </div>
  );
}

export function WalkInForm() {
  const { state, onSubmit, pending, errorFor } = useFormAction(registerWalkIn);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success" || state.status === "preview") form.current?.reset();
  }, [state]);
  return (
    <form ref={form} onSubmit={onSubmit} noValidate className="space-y-3">
      <FormStatus state={state} />
      <Field id="note" label="Note for staff" optional hint="For example: needs help reading. No names or card numbers." maxLength={80} error={errorFor("note")} />
      <Submit pending={pending} variant="outline">
        Add walk-in
      </Submit>
    </form>
  );
}

// Shop: schedule ----------------------------------------------------------------------

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const blank = (weekday: number): ScheduleWindow => ({ weekday, startTime: "09:00", endTime: "11:00", slotMinutes: 60, capacity: 15, walkInReserve: 3 });

export function ScheduleForm({ initial }: { initial: ScheduleWindow[] }) {
  const { state, onSubmit, pending } = useFormAction(saveSchedule);
  const [windows, setWindows] = useState(initial);
  const update = (index: number, patch: Partial<ScheduleWindow>) => setWindows((w) => w.map((x, i) => (i === index ? { ...x, ...patch } : x)));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <input type="hidden" name="windows" value={JSON.stringify(windows)} />
      <FormStatus state={state} />
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {WEEKDAYS.map((name, d) => {
          const weekday = d + 1;
          const rows = windows.map((w, i) => ({ w, i })).filter(({ w }) => w.weekday === weekday);
          return (
            <li key={name} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{name}</p>
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => setWindows((w) => [...w, blank(weekday)])}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add window
                </Button>
              </div>
              {rows.length === 0 && <p className="text-[0.875rem] text-muted-foreground">No bookable times. Walk-ins only.</p>}
              {rows.map(({ w, i }) => (
                <fieldset key={i} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
                  <legend className="sr-only">{`${name}, window ${rows.findIndex((r) => r.i === i) + 1}`}</legend>
                  <Field id={`start-${i}`} name={`start-${i}`} label="From" type="time" value={w.startTime} onChange={(e) => update(i, { startTime: e.target.value })} />
                  <Field id={`end-${i}`} name={`end-${i}`} label="To" type="time" value={w.endTime} onChange={(e) => update(i, { endTime: e.target.value })} />
                  <SelectField id={`len-${i}`} name={`len-${i}`} label="Slot length" value={w.slotMinutes} onChange={(e) => update(i, { slotMinutes: Number(e.target.value) as ScheduleWindow["slotMinutes"] })}>
                    {SLOT_LENGTHS.map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </SelectField>
                  <Field id={`cap-${i}`} name={`cap-${i}`} label="Visitors per slot" type="number" inputMode="numeric" min={1} value={w.capacity} onChange={(e) => update(i, { capacity: Number(e.target.value) })} className="tabular-nums" />
                  <Field id={`res-${i}`} name={`res-${i}`} label="Kept for walk-ins" type="number" inputMode="numeric" min={0} value={w.walkInReserve} onChange={(e) => update(i, { walkInReserve: Number(e.target.value) })} className="tabular-nums" />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${name} window`} className="size-11" onClick={() => setWindows((all) => all.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </fieldset>
              ))}
            </li>
          );
        })}
      </ul>
      <p className="text-[0.8125rem] text-muted-foreground">
        Saving changes the weekly pattern only. Times already published keep their bookings; publish again to add new ones.
      </p>
      <Submit pending={pending}>Save schedule</Submit>
    </form>
  );
}

export function PublishForm() {
  const { state, onSubmit, pending, errorFor } = useFormAction(publishSlots);
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <SelectField id="days" label="Days ahead" defaultValue="7" error={errorFor("days")}>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
        </SelectField>
      </div>
      <Submit pending={pending} variant="outline">
        Publish slots
      </Submit>
      <div className="basis-full">
        <FormStatus state={state} />
      </div>
    </form>
  );
}
