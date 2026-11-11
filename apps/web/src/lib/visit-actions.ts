"use server";

import {
  cardLinkSchema,
  checkInSchema,
  formatBookingCode,
  profileSchema,
  publishSlotsSchema,
  scheduleSchema,
  slotChoiceSchema,
  slotStatusSchema,
  walkInSchema,
  type QueueEntry,
} from "@rationsync/shared";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { invalid, preview, type ActionState } from "@/lib/action-state";
import { entries, fromApiError } from "@/lib/action-helpers";
import { apiSend } from "@/lib/api";
import { formatTimeRange, formatWeekdayDate } from "@/lib/format";
import { requireApprovedShop, requireRole } from "@/lib/session";
import { DEMO_TOKEN, demoBookings, demoCollectionSlots, demoShopQueue } from "@/lib/visit-fixtures";

const done = (message: string): ActionState => {
  refresh();
  return { status: "success", message };
};
const when = (startsAt: string, endsAt: string) => `${formatWeekdayDate(startsAt)}, ${formatTimeRange(startsAt, endsAt)}`;

// Household ---------------------------------------------------------------------

export async function linkCard(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("beneficiary");
  const parsed = cardLinkSchema.safeParse(entries(formData));
  if (!parsed.success) return invalid(parsed.error);

  if (session.mode === "demo") {
    if (session.persona !== "beneficiary-new") return { status: "error", message: "This account already has a linked card." };
    const matches = parsed.data.cardNumber === "DEMO-000101" && parsed.data.headOfFamily.toLowerCase() === "demo household 101";
    if (!matches) return { status: "error", message: "No demo card matches those details." };
    return preview("demo card ••01 would be linked to this account, with Demo FPS Vijayanagar as your shop.");
  }
  try {
    await apiSend("POST", "/api/v1/beneficiary/card-link", session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  redirect("/beneficiary?linked=1");
}

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("beneficiary");
  const parsed = profileSchema.safeParse(entries(formData));
  if (!parsed.success) return invalid(parsed.error);
  if (session.mode === "demo") return preview("your name and language would be updated.");
  try {
    await apiSend("PATCH", "/api/v1/beneficiary/profile", session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  return done("Saved.");
}

export async function bookSlot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("beneficiary");
  const parsed = slotChoiceSchema.safeParse(entries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a time first." };

  if (session.mode === "demo") {
    const now = new Date();
    const slot = demoCollectionSlots(now).find((s) => s.id === parsed.data.slotId);
    if (!slot || slot.status !== "open" || slot.remaining === 0) return { status: "error", message: "That time is full or not taking bookings. Choose another." };
    if (session.persona !== "beneficiary-new" && demoBookings(now).upcoming.length > 0) {
      return { status: "error", message: "You already have an upcoming booking. Cancel or move it before booking another time." };
    }
    return preview(`you would be booked for ${when(slot.startsAt, slot.endsAt)}.`);
  }
  let id: string;
  try {
    ({ booking: { id } } = await apiSend<{ booking: { id: string } }>("POST", "/api/v1/beneficiary/bookings", session.accessToken, parsed.data));
  } catch (err) {
    return fromApiError(err);
  }
  redirect(`/beneficiary/visits/${id}?booked=1`);
}

export async function rescheduleBooking(bookingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("beneficiary");
  const parsed = slotChoiceSchema.safeParse(entries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a new time first." };

  if (session.mode === "demo") {
    const slot = demoCollectionSlots(new Date()).find((s) => s.id === parsed.data.slotId);
    if (!slot || slot.status !== "open" || slot.remaining === 0) return { status: "error", message: "That time is full or not taking bookings. Choose another." };
    return preview(`your visit would move to ${when(slot.startsAt, slot.endsAt)} and the old time would be released.`);
  }
  let id: string;
  try {
    ({ booking: { id } } = await apiSend<{ booking: { id: string } }>(
      "POST",
      `/api/v1/beneficiary/bookings/${encodeURIComponent(bookingId)}/reschedule`,
      session.accessToken,
      parsed.data,
    ));
  } catch (err) {
    return fromApiError(err);
  }
  redirect(`/beneficiary/visits/${id}?moved=1`);
}

export async function cancelBooking(bookingId: string, _prev: ActionState): Promise<ActionState> {
  const session = await requireRole("beneficiary");
  if (session.mode === "demo") return preview("the booking would be cancelled and its place released.");
  try {
    await apiSend("POST", `/api/v1/beneficiary/bookings/${encodeURIComponent(bookingId)}/cancel`, session.accessToken, {});
  } catch (err) {
    return fromApiError(err);
  }
  return done("Booking cancelled. You can book another time, or walk in during shop hours.");
}

// Shop ------------------------------------------------------------------------------

export async function saveSchedule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  let windows: unknown;
  try {
    windows = JSON.parse(String(formData.get("windows") ?? "[]"));
  } catch {
    return { status: "error", message: "The schedule could not be read. Reload and try again." };
  }
  const parsed = scheduleSchema.safeParse({ windows });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the schedule." };
  if (session.mode === "demo") return preview(`a weekly schedule of ${parsed.data.windows.length} collection windows would be saved.`);
  try {
    await apiSend("POST", "/api/v1/shop/booking-schedule", session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  return done("Schedule saved. Publish slots to make the new times bookable.");
}

export async function publishSlots(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const parsed = publishSlotsSchema.safeParse(entries(formData));
  if (!parsed.success) return invalid(parsed.error);
  if (session.mode === "demo") return preview(`slots for the next ${parsed.data.days} days would be created from the schedule.`);
  try {
    const { created } = await apiSend<{ created: number }>("POST", "/api/v1/shop/slots/publish", session.accessToken, parsed.data);
    return done(created ? `${created} new ${created === 1 ? "slot" : "slots"} published.` : "No new slots: every scheduled time already exists.");
  } catch (err) {
    return fromApiError(err);
  }
}

export async function setSlotStatus(slotId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const parsed = slotStatusSchema.safeParse(entries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const outcome = {
    open: "the slot would take bookings again.",
    paused: "the slot would stop taking new bookings; existing bookings stay.",
    closed: "the slot would close and every household booked into it would be told your reason.",
  }[parsed.data.status];
  if (session.mode === "demo") return preview(outcome);
  try {
    await apiSend("POST", `/api/v1/shop/slots/${encodeURIComponent(slotId)}/status`, session.accessToken, parsed.data);
  } catch (err) {
    return fromApiError(err);
  }
  return done(
    parsed.data.status === "closed"
      ? "Slot closed. Booked households were notified."
      : parsed.data.status === "paused"
        ? "Paused. Existing bookings stand."
        : "Taking bookings again.",
  );
}

/** One-tap pause or resume; closing goes through setSlotStatus with a reason and a confirmation. */
export async function changeSlotPause(slotId: string, status: "open" | "paused", prev: ActionState): Promise<ActionState> {
  const formData = new FormData();
  formData.set("status", status);
  return setSlotStatus(slotId, prev, formData);
}

/** One field takes either a scanned token or a typed code; the scanner fills it in. */
export async function checkIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const raw = String(formData.get("value") ?? "").trim();
  const parsed = checkInSchema.safeParse(/^[0-9a-f]{32}$/i.test(raw) ? { token: raw } : { code: raw });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a booking code.", fieldErrors: { value: "Check the code" } };
  }

  if (session.mode === "demo") {
    const queue = demoShopQueue(new Date());
    const code = "code" in parsed.data ? formatBookingCode(parsed.data.code) : null;
    const entered = [queue.nowServing, ...queue.waiting, ...queue.finished].find((e): e is QueueEntry => e?.bookingCode === code);
    if (entered) return { status: "success", message: `Already checked in as number ${entered.number}. Nothing was added.` };
    const expected = queue.expected.find((a) => a.code === code);
    if (expected) {
      const next = Math.max(0, ...queue.waiting.map((e) => e.number), queue.nowServing?.number ?? 0, ...queue.finished.map((e) => e.number)) + 1;
      return preview(`booking ${expected.code} would be checked in as queue number ${next}.`);
    }
    if ("token" in parsed.data ? parsed.data.token === DEMO_TOKEN : code === formatBookingCode(DEMO_TOKEN.slice(0, 10).toUpperCase())) {
      return { status: "error", message: "This booking is for a later day. Check-in opens an hour before its time." };
    }
    return { status: "error", message: "No booking at your shop matches this code." };
  }

  try {
    const { alreadyCheckedIn, entry } = await apiSend<{ alreadyCheckedIn: boolean; entry: QueueEntry }>(
      "POST",
      "/api/v1/shop/check-ins",
      session.accessToken,
      parsed.data,
    );
    return done(
      alreadyCheckedIn
        ? `Already checked in as number ${entry.number}. Nothing was added.`
        : `Checked in. Queue number ${entry.number}.`,
    );
  } catch (err) {
    return fromApiError(err, { invalid_token: "value" });
  }
}

export async function registerWalkIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireApprovedShop();
  const parsed = walkInSchema.safeParse({ note: String(formData.get("note") ?? "") || undefined });
  if (!parsed.success) return invalid(parsed.error);
  if (session.mode === "demo") return preview("the visitor would get the next queue number.");
  try {
    const { entry } = await apiSend<{ entry: QueueEntry }>("POST", "/api/v1/shop/queue/walk-ins", session.accessToken, parsed.data);
    return done(`Walk-in added. Queue number ${entry.number}.`);
  } catch (err) {
    return fromApiError(err);
  }
}

export async function callNext(_prev: ActionState): Promise<ActionState> {
  const session = await requireApprovedShop();
  if (session.mode === "demo") {
    const q = demoShopQueue(new Date());
    return q.nowServing
      ? { status: "error", message: `Number ${q.nowServing.number} is still at the counter. Mark it served or not present first.` }
      : preview("the lowest waiting number would be called.");
  }
  try {
    const { entry } = await apiSend<{ entry: QueueEntry }>("POST", "/api/v1/shop/queue/call-next", session.accessToken, {});
    return done(`Calling number ${entry.number}.`);
  } catch (err) {
    return fromApiError(err);
  }
}

export async function finishEntry(entryId: string, outcome: "served" | "no_show", _prev: ActionState): Promise<ActionState> {
  const session = await requireApprovedShop();
  const label = outcome === "served" ? "served" : "not present";
  if (session.mode === "demo") return preview(`the visitor would be marked ${label}.`);
  try {
    const { entry } = await apiSend<{ entry: QueueEntry }>(
      "POST",
      `/api/v1/shop/queue/${encodeURIComponent(entryId)}/finish`,
      session.accessToken,
      { outcome },
    );
    return done(`Number ${entry.number} marked ${label}.`);
  } catch (err) {
    return fromApiError(err);
  }
}

export async function markNoShow(bookingId: string, _prev: ActionState): Promise<ActionState> {
  const session = await requireApprovedShop();
  if (session.mode === "demo") return preview("the booking would be marked not attended and the household told.");
  try {
    await apiSend("POST", `/api/v1/shop/bookings/${encodeURIComponent(bookingId)}/no-show`, session.accessToken, {});
  } catch (err) {
    return fromApiError(err);
  }
  return done("Marked not attended.");
}
