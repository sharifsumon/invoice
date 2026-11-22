import { describe, expect, it } from "vitest";
import { allocateMilestones, amountInWords, dec, formatMoney, sum } from "@/server/core/money";

describe("milestone allocation (BRD §5.4)", () => {
  it("splits exactly and puts the rounding residual on the last milestone", () => {
    const a = allocateMilestones(dec("1000.00"), [dec("33.3333"), dec("33.3333"), dec("33.3334")]);
    expect(a.map(String)).toEqual(["333.33", "333.33", "333.34"]);
    expect(sum(a).eq(1000)).toBe(true);
  });

  it("always sums to the PO value for awkward values", () => {
    for (const v of ["0.01", "99.99", "1234567.89", "100", "7.77"]) {
      const a = allocateMilestones(dec(v), [dec(10), dec(15.5), dec(24.5), dec(50)]);
      expect(sum(a).eq(dec(v))).toBe(true);
    }
  });

  it("rejects plans that do not total exactly 100%", () => {
    expect(() => allocateMilestones(dec(100), [dec(50), dec(49.99)])).toThrow(/exactly 100%/);
    expect(() => allocateMilestones(dec(100), [dec(60), dec(41)])).toThrow(/exactly 100%/);
    expect(() => allocateMilestones(dec(100), [])).toThrow();
  });

  it("uses decimal arithmetic, not floats", () => {
    const a = allocateMilestones(dec("0.30"), [dec(33.3333), dec(33.3333), dec(33.3334)]);
    expect(a.map(String)).toEqual(["0.1", "0.1", "0.1"]);
  });
});

describe("formatting", () => {
  it("formats money with grouping", () => {
    expect(formatMoney(dec("1234567.5"), "USD")).toBe("USD 1,234,567.50");
  });
  it("writes amounts in words", () => {
    expect(amountInWords(dec("1250.50"), "USD")).toBe("USD One Thousand Two Hundred Fifty and 50/100 Only");
  });
});
