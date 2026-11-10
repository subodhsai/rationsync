import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { maskCardNumber } from "../src/routes/beneficiary.js";

describe("loadConfig", () => {
  it("starts in development without Supabase, reporting what is missing", () => {
    const config = loadConfig({});
    expect(config.port).toBe(4000);
    expect(config.corsOrigins).toEqual(["http://localhost:3000"]);
    expect(config.missing).toEqual(["SUPABASE_URL", "DATABASE_URL"]);
  });

  it("refuses to start in production without required variables", () => {
    expect(() => loadConfig({ NODE_ENV: "production", SUPABASE_URL: "https://x.supabase.co" })).toThrow(
      /DATABASE_URL, CORS_ALLOWED_ORIGINS/,
    );
  });

  it("treats blank values copied from .env.example as unset", () => {
    expect(loadConfig({ SUPABASE_URL: "", DATABASE_URL: "  " }).missing).toEqual(["SUPABASE_URL", "DATABASE_URL"]);
  });

  it("rejects a wildcard CORS origin", () => {
    expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: "*" })).toThrow(/explicit origins/);
  });

  it("normalises origin lists", () => {
    expect(loadConfig({ CORS_ALLOWED_ORIGINS: "https://a.example/, http://localhost:3000" }).corsOrigins).toEqual([
      "https://a.example",
      "http://localhost:3000",
    ]);
  });
});

describe("maskCardNumber", () => {
  it("shows only the last two characters", () => {
    expect(maskCardNumber("DEMO-000123")).toBe("•••••••••23");
  });
});
