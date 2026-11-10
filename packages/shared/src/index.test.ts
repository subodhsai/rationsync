import { describe, expect, it } from "vitest";
import {
  accountTypeSchema,
  movementDelta,
  reviewDecisionSchema,
  shopRegistrationSchema,
  signUpSchema,
  stockLevel,
  stockMovementSchema,
  thresholdSchema,
} from "./index.js";

describe("stockLevel", () => {
  it("is out at zero, low at or below threshold, ok above", () => {
    expect(stockLevel(0, 50)).toBe("out");
    expect(stockLevel(50, 50)).toBe("low");
    expect(stockLevel(50.5, 50)).toBe("ok");
    expect(stockLevel(10, 0)).toBe("ok");
  });
});

describe("sign-up account types", () => {
  it("never accepts warehouse_admin", () => {
    expect(accountTypeSchema.safeParse("warehouse_admin").success).toBe(false);
    expect(
      signUpSchema.safeParse({
        fullName: "Demo User",
        email: "demo@example.com",
        password: "longenough",
        accountType: "warehouse_admin",
      }).success,
    ).toBe(false);
  });
});

const validRegistration = {
  fpsId: " demo-fps-mys-0150 ",
  name: "Demo FPS Gokulam",
  district: "Mysuru",
  taluk: "Mysuru",
  address: "3rd Main, Gokulam, Mysuru",
  pinCode: "570002",
  contactPhone: "+91 98450-12345",
  contactEmail: "",
  warehouseId: "0d9a0000-0000-4000-a000-000000000001",
};

describe("shopRegistrationSchema", () => {
  it("normalises a valid application", () => {
    const result = shopRegistrationSchema.parse(validRegistration);
    expect(result.fpsId).toBe("DEMO-FPS-MYS-0150");
    expect(result.contactPhone).toBe("+91 98450 12345");
    expect(result.contactEmail).toBeNull();
  });

  it("accepts a landline with STD code", () => {
    expect(shopRegistrationSchema.parse({ ...validRegistration, contactPhone: "0821 2345678" }).contactPhone).toBe(
      "08212345678",
    );
  });

  it.each([
    ["a PIN code outside Karnataka", { pinCode: "110001" }, "pinCode"],
    ["an FPS ID with spaces", { fpsId: "FPS 0150" }, "fpsId"],
    ["a district outside the list", { district: "Goa" }, "district"],
    ["a short mobile number", { contactPhone: "98450" }, "contactPhone"],
    ["a malformed email", { contactEmail: "shop@" }, "contactEmail"],
    ["a missing warehouse", { warehouseId: "" }, "warehouseId"],
  ])("rejects %s", (_label, change, field) => {
    const result = shopRegistrationSchema.safeParse({ ...validRegistration, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toContain(field);
  });
});

describe("stock movement input", () => {
  it("derives the signed quantity from the kind", () => {
    const parse = (input: object) => movementDelta(stockMovementSchema.parse(input));
    const base = { commodityCode: "RICE", quantity: "25.5", reason: "Test reason" };
    expect(parse({ ...base, kind: "distribution" })).toBe(-25.5);
    expect(parse({ ...base, kind: "opening_balance" })).toBe(25.5);
    expect(parse({ ...base, kind: "adjustment", direction: "decrease" })).toBe(-25.5);
    expect(parse({ ...base, kind: "adjustment", direction: "increase" })).toBe(25.5);
  });

  it("does not let a shop record a warehouse receipt", () => {
    expect(
      stockMovementSchema.safeParse({ kind: "receipt", commodityCode: "RICE", quantity: 10, reason: "Delivery" }).success,
    ).toBe(false);
  });

  it("rejects zero, negative and over-precise quantities", () => {
    for (const quantity of [0, -5, 1.234]) {
      expect(
        stockMovementSchema.safeParse({ kind: "distribution", commodityCode: "RICE", quantity, reason: "Test" }).success,
      ).toBe(false);
    }
  });

  it("requires a direction for adjustments", () => {
    expect(
      stockMovementSchema.safeParse({ kind: "adjustment", commodityCode: "RICE", quantity: 5, reason: "Recount" }).success,
    ).toBe(false);
  });
});

describe("threshold and review input", () => {
  it("accepts zero but not negative thresholds", () => {
    expect(thresholdSchema.safeParse({ lowStockThreshold: "0" }).success).toBe(true);
    expect(thresholdSchema.safeParse({ lowStockThreshold: "-1" }).success).toBe(false);
  });

  it("requires a reason for every decision", () => {
    expect(reviewDecisionSchema.safeParse({ decision: "approved", reason: "  " }).success).toBe(false);
    expect(reviewDecisionSchema.safeParse({ decision: "rejected", reason: "FPS ID does not match licence" }).success).toBe(
      true,
    );
  });
});
