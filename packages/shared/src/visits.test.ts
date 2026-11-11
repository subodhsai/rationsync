import { describe, expect, it } from "vitest";
import {
  cardLinkSchema,
  checkInSchema,
  estimateWait,
  formatBookingCode,
  scheduleSchema,
  slotStatusSchema,
} from "./index.js";

describe("cardLinkSchema", () => {
  it("accepts only fictional DEMO- card numbers, normalised to upper case", () => {
    expect(cardLinkSchema.parse({ cardNumber: " demo-000101 ", headOfFamily: "Demo household 101" }).cardNumber).toBe("DEMO-000101");
    for (const cardNumber of ["KA-123456789", "123456789012", "DEMO-12345"]) {
      expect(cardLinkSchema.safeParse({ cardNumber, headOfFamily: "Someone" }).success).toBe(false);
    }
  });
});

describe("checkInSchema", () => {
  it("takes a 32-character QR token or a 10-character typed code", () => {
    expect(checkInSchema.parse({ token: "a".repeat(32) })).toEqual({ token: "a".repeat(32) });
    expect(checkInSchema.parse({ code: "4f2a-9c1b-7d" })).toEqual({ code: "4F2A9C1B7D" });
    expect(checkInSchema.safeParse({ code: "4F2A-9C1B" }).success).toBe(false);
    expect(checkInSchema.safeParse({ token: "not-a-token" }).success).toBe(false);
  });

  it("formats a code in groups for reading aloud", () => {
    expect(formatBookingCode("4F2A9C1B7D")).toBe("4F2A-9C1B-7D");
  });
});

describe("scheduleSchema", () => {
  const window = { weekday: 1, startTime: "09:00", endTime: "11:00", slotMinutes: 60, capacity: 15, walkInReserve: 3 };

  it("accepts separate windows and rejects overlapping ones", () => {
    expect(scheduleSchema.safeParse({ windows: [window, { ...window, startTime: "16:00", endTime: "18:00" }] }).success).toBe(true);
    expect(scheduleSchema.safeParse({ windows: [window, { ...window, startTime: "10:00", endTime: "12:00" }] }).success).toBe(false);
  });

  it("keeps walk-in places below capacity and the window at least one slot long", () => {
    expect(scheduleSchema.safeParse({ windows: [{ ...window, walkInReserve: 15 }] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ windows: [{ ...window, endTime: "09:30" }] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ windows: [{ ...window, slotMinutes: 45 }] }).success).toBe(false);
  });
});

describe("slotStatusSchema", () => {
  it("requires a reason to close a slot but not to pause it", () => {
    expect(slotStatusSchema.safeParse({ status: "paused" }).success).toBe(true);
    expect(slotStatusSchema.safeParse({ status: "closed" }).success).toBe(false);
    expect(slotStatusSchema.safeParse({ status: "closed", reason: "Stock delivery today" }).success).toBe(true);
  });
});

describe("estimateWait", () => {
  it("gives no estimate with fewer than five observed visits", () => {
    expect(estimateWait([120, 180, 240, 300], 3)).toMatchObject({ status: "insufficient", basis: expect.stringContaining("has 4") });
  });

  it("multiplies people ahead by the median visit time", () => {
    expect(estimateWait([60, 120, 180, 240, 3000], 4)).toMatchObject({ status: "estimate", minutes: 12 });
    expect(estimateWait([60, 120, 180, 240, 300, 360], 2)).toMatchObject({ minutes: 7 });
    expect(estimateWait([60, 60, 60, 60, 60], 0)).toMatchObject({ minutes: 0 });
  });
});
