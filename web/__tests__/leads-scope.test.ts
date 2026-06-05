import { describe, it, expect } from "vitest";
import { callInLeadsScope, type LeadsScope } from "@/lib/leads-source";

// The Prod/Test scope must be stable and independent of the (volatile, ~8k-row)
// leads_rdv table. The definition is: Test = number IS a sandbox test number;
// Prod = number is NOT a sandbox test number.

const TEST: LeadsScope = { mode: "include", phones: new Set(["+2305748009", "+2300000001"]) };
const PROD: LeadsScope = { mode: "exclude", phones: new Set(["+2305748009", "+2300000001"]) };

describe("callInLeadsScope (Prod = not-test, Test = test)", () => {
  it("Test scope keeps only sandbox numbers", () => {
    expect(callInLeadsScope("+2305748009", TEST)).toBe(true);
    expect(callInLeadsScope("+447943293504", TEST)).toBe(false); // real UK lead
    expect(callInLeadsScope(null, TEST)).toBe(false); // inbound w/o dest → not test
  });

  it("Prod scope keeps every non-sandbox call, even numbers absent from leads_rdv", () => {
    expect(callInLeadsScope("+447943293504", PROD)).toBe(true); // real call not yet in leads_rdv
    expect(callInLeadsScope("+2305748009", PROD)).toBe(false); // a test number never counts as prod
    expect(callInLeadsScope(null, PROD)).toBe(true); // inbound counts as prod
  });

  it("normalises whitespace on both sides", () => {
    expect(callInLeadsScope("+230 5748 009", TEST)).toBe(true);
    expect(callInLeadsScope("+230 5748 009", PROD)).toBe(false);
  });

  it("null scope = no filter (keep everything)", () => {
    expect(callInLeadsScope("+447943293504", null)).toBe(true);
    expect(callInLeadsScope(null, null)).toBe(true);
  });
});
