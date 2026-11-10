import { describe, expect, it } from "vitest";
import { accountTypeSchema, signUpSchema, stockLevel } from "./index.js";

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
