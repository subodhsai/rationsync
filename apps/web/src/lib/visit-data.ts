import "server-only";
import type {
  AttendanceSummary,
  BeneficiaryBooking,
  CollectionSlot,
  Language,
  ScheduleWindow,
  ShopAppointment,
  ShopQueue,
  ShopSlot,
} from "@rationsync/shared";
import { connection } from "next/server";
import { ApiError, apiGet } from "@/lib/api";
import type { Session } from "@/lib/session";
import {
  demoAttendance,
  demoBookings,
  demoCollectionSlots,
  demoSchedule,
  demoShopHistory,
  demoShopQueue,
  demoShopSlots,
} from "@/lib/visit-fixtures";

// Phase 4 loaders: fixtures in preview mode (built from the current time), the API otherwise.

type Live = Extract<Session, { mode: "live" }>;
const live = <T>(session: Live, path: string) => apiGet<T>(path, session.accessToken);
const now = async () => {
  await connection();
  return new Date();
};

/** Request time on the server, for deciding which controls apply (for example "not attended"). */
export const serverNow = async () => (await now()).getTime();

// Household ---------------------------------------------------------------------

export async function getProfile(session: Session): Promise<{ fullName: string; preferredLanguage: Language }> {
  if (session.mode === "demo") return { fullName: session.me.fullName, preferredLanguage: session.me.preferredLanguage };
  return (await live<{ profile: { fullName: string; preferredLanguage: Language } }>(session, "/api/v1/beneficiary/profile")).profile;
}

export async function getCollectionSlots(session: Session): Promise<CollectionSlot[]> {
  if (session.mode === "demo") return demoCollectionSlots(await now());
  return (await live<{ items: CollectionSlot[] }>(session, "/api/v1/beneficiary/slots")).items;
}

export async function getMyBookings(
  session: Session,
  scope: "upcoming" | "past",
  page = 1,
): Promise<{ items: BeneficiaryBooking[]; hasMore: boolean }> {
  if (session.mode === "demo") {
    if (session.persona === "beneficiary-new") return { items: [], hasMore: false };
    return { items: demoBookings(await now())[scope], hasMore: false };
  }
  return live(session, `/api/v1/beneficiary/bookings?scope=${scope}&page=${page}`);
}

/** The household's own booking, with its QR token while active. Null if it is not theirs. */
export async function getMyBooking(session: Session, id: string): Promise<BeneficiaryBooking | null> {
  if (session.mode === "demo") {
    const { upcoming, past } = demoBookings(await now());
    return session.persona === "beneficiary-new" ? null : ([...upcoming, ...past].find((b) => b.id === id) ?? null);
  }
  try {
    return (await live<{ booking: BeneficiaryBooking }>(session, `/api/v1/beneficiary/bookings/${encodeURIComponent(id)}`)).booking;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Shop ------------------------------------------------------------------------------

export async function getSchedule(session: Session): Promise<ScheduleWindow[]> {
  if (session.mode === "demo") return demoSchedule;
  return (await live<{ windows: ScheduleWindow[] }>(session, "/api/v1/shop/booking-schedule")).windows;
}

export async function getShopSlots(session: Session, days = 14): Promise<ShopSlot[]> {
  if (session.mode === "demo") return demoShopSlots(await now(), days);
  return (await live<{ items: ShopSlot[] }>(session, `/api/v1/shop/slots?days=${days}`)).items;
}

export async function getShopQueue(session: Session): Promise<ShopQueue> {
  if (session.mode === "demo") return demoShopQueue(await now());
  return (await live<{ queue: ShopQueue }>(session, "/api/v1/shop/queue")).queue;
}

export async function getAppointmentHistory(session: Session, page: number): Promise<{ items: ShopAppointment[]; hasMore: boolean }> {
  if (session.mode === "demo") {
    const all = demoShopHistory(await now());
    return { items: all.slice((page - 1) * 25, page * 25), hasMore: all.length > page * 25 };
  }
  return live(session, `/api/v1/shop/appointments?scope=history&page=${page}`);
}

export async function getAttendance(session: Session): Promise<AttendanceSummary> {
  if (session.mode === "demo") return demoAttendance(await now());
  return (await live<{ summary: AttendanceSummary }>(session, "/api/v1/shop/attendance")).summary;
}
