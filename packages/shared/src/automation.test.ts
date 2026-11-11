import { describe, expect, it } from "vitest";
import {
  buildSuggestion,
  forecastCoverage,
  receiveShipmentSchema,
  recommendPriority,
  replenishmentRequestSchema,
  requestDecisionSchema,
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSITIONS,
  stockLevelsSchema,
  suggestQuantity,
  warehouseMovementDelta,
  warehouseMovementSchema,
} from "./index.js";

const rice = { commodityCode: "RICE", nameEn: "Rice", nameKn: "ಅಕ್ಕಿ", unit: "kg" };

describe("suggestQuantity", () => {
  it("fills to twice the threshold when no target is set (the 80 of 100 kg example)", () => {
    expect(suggestQuantity({ onHand: 80, threshold: 100, target: null, incoming: 0, hasOpenRequest: false })).toEqual({
      quantity: 120,
      target: 200,
      targetIsDefault: true,
    });
  });

  it("uses the configured target and subtracts stock already on its way", () => {
    expect(suggestQuantity({ onHand: 80, threshold: 100, target: 500, incoming: 150, hasOpenRequest: false }).quantity).toBe(270);
  });

  it("suggests nothing above the threshold or while a request is open", () => {
    expect(suggestQuantity({ onHand: 101, threshold: 100, target: null, incoming: 0, hasOpenRequest: false }).quantity).toBe(0);
    expect(suggestQuantity({ onHand: 10, threshold: 100, target: null, incoming: 0, hasOpenRequest: true }).quantity).toBe(0);
  });

  it("never goes negative and rounds up to whole units", () => {
    expect(suggestQuantity({ onHand: 90, threshold: 100, target: 150, incoming: 100, hasOpenRequest: false }).quantity).toBe(0);
    expect(suggestQuantity({ onHand: 99.5, threshold: 100, target: 200, incoming: 0, hasOpenRequest: false }).quantity).toBe(101);
  });
});

describe("forecastCoverage", () => {
  it("refuses to estimate from too little history", () => {
    expect(forecastCoverage(500, { distributed: 300, entries: 2, days: 20 }, "kg").status).toBe("insufficient");
    expect(forecastCoverage(500, { distributed: 300, entries: 5, days: 6 }, "kg").status).toBe("insufficient");
    expect(forecastCoverage(500, { distributed: 0, entries: 0, days: 30 }, "kg")).toMatchObject({
      status: "insufficient",
      basis: expect.stringContaining("has 0 over 30 days"),
    });
  });

  it("divides distributed stock by days of history and rounds cover down", () => {
    const f = forecastCoverage(1000, { distributed: 3000, entries: 12, days: 30 }, "kg");
    expect(f).toMatchObject({ status: "estimate", dailyUsage: 100, daysOfCover: 10 });
    expect(forecastCoverage(250, { distributed: 700, entries: 7, days: 7 }, "kg")).toMatchObject({ daysOfCover: 2 });
  });
});

describe("recommendPriority", () => {
  const none = forecastCoverage(0, { distributed: 0, entries: 0, days: 0 }, "kg");
  const usage = (onHand: number) => forecastCoverage(onHand, { distributed: 3000, entries: 10, days: 30 }, "kg");

  it("ranks out of stock and very short cover as urgent, with a reason", () => {
    expect(recommendPriority(0, 100, none, "kg")).toEqual({ priority: "urgent", reason: "Out of stock." });
    expect(recommendPriority(250, 100, usage(250), "kg")).toMatchObject({ priority: "urgent", reason: expect.stringContaining("2 days") });
  });

  it("uses half the threshold and a week of cover for high", () => {
    expect(recommendPriority(50, 100, none, "kg").priority).toBe("high");
    expect(recommendPriority(600, 1000, usage(600), "kg").priority).toBe("high");
  });

  it("is normal at or below the threshold and low above it", () => {
    expect(recommendPriority(80, 100, none, "kg").priority).toBe("normal");
    expect(recommendPriority(5000, 100, usage(5000), "kg").priority).toBe("low");
  });
});

describe("buildSuggestion", () => {
  it("shows the open request instead of a new quantity", () => {
    const s = buildSuggestion(
      { ...rice, quantity: 80, lowStockThreshold: 100, targetStock: null },
      { id: "r1", reference: "RQ-00001", status: "approved", quantity: 120 },
      { distributed: 0, entries: 0, days: 0 },
    );
    expect(s).toMatchObject({ suggestedQuantity: 0, incoming: 120, recommendation: { priority: "normal" } });
  });
});

describe("Phase 3 input schemas", () => {
  it("validates replenishment requests", () => {
    const ok = replenishmentRequestSchema.safeParse({
      commodityCode: "RICE",
      quantity: "120",
      reason: "Below threshold",
      priority: "high",
      suggestedQuantity: "",
    });
    expect(ok.success && ok.data).toMatchObject({ quantity: 120, suggestedQuantity: undefined });
    expect(replenishmentRequestSchema.safeParse({ commodityCode: "RICE", quantity: 0, reason: "x", priority: "asap" }).error?.issues)
      .toHaveLength(3);
  });

  it("requires an approved quantity only for approvals", () => {
    expect(requestDecisionSchema.safeParse({ decision: "approved", reason: "Stock available" }).success).toBe(false);
    expect(requestDecisionSchema.safeParse({ decision: "rejected", reason: "Duplicate of RQ-00002" }).success).toBe(true);
  });

  it("allows zero received but not negative quantities", () => {
    const item = { itemId: "0d9a0000-0000-4000-b000-000000000101" };
    expect(receiveShipmentSchema.safeParse({ items: [{ ...item, receivedQuantity: 0, damagedQuantity: "5" }] }).success).toBe(true);
    expect(receiveShipmentSchema.safeParse({ items: [{ ...item, receivedQuantity: -1, damagedQuantity: 0 }] }).success).toBe(false);
  });

  it("keeps the target above the threshold", () => {
    expect(stockLevelsSchema.safeParse({ lowStockThreshold: 100, targetStock: "" }).success).toBe(true);
    expect(stockLevelsSchema.safeParse({ lowStockThreshold: 100, targetStock: 100 }).success).toBe(false);
  });

  it("signs warehouse adjustments by direction and allows no free dispatch", () => {
    const parsed = warehouseMovementSchema.parse({
      kind: "adjustment",
      direction: "decrease",
      commodityCode: "RICE",
      quantity: 40,
      reason: "Damaged bags",
    });
    expect(warehouseMovementDelta(parsed)).toBe(-40);
    expect(warehouseMovementSchema.safeParse({ kind: "dispatch", commodityCode: "RICE", quantity: 1, reason: "Test" }).success).toBe(false);
  });
});

describe("SHIPMENT_TRANSITIONS", () => {
  it("covers every status and only ends in terminal states", () => {
    expect(Object.keys(SHIPMENT_TRANSITIONS).sort()).toEqual([...SHIPMENT_STATUSES].sort());
    for (const terminal of ["delivered", "partially_received", "cancelled"] as const) {
      expect(SHIPMENT_TRANSITIONS[terminal]).toEqual([]);
    }
    expect(SHIPMENT_TRANSITIONS.dispatched).not.toContain("cancelled");
  });
});
