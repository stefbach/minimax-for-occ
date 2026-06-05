import { describe, it, expect } from "vitest";
import { parseCallSystem, callMatchesSystem } from "@/lib/call-system";

describe("call-system filter", () => {
  it("parses the param safely", () => {
    expect(parseCallSystem("retell")).toBe("retell");
    expect(parseCallSystem("axon")).toBe("axon");
    expect(parseCallSystem(null)).toBe("all");
    expect(parseCallSystem("garbage")).toBe("all");
  });
  it("classifies retell vs axon by metadata.source", () => {
    expect(callMatchesSystem("retell_sync", "retell")).toBe(true);
    expect(callMatchesSystem("retell_sync", "axon")).toBe(false);
    expect(callMatchesSystem(null, "axon")).toBe(true);       // native Axon
    expect(callMatchesSystem(undefined, "axon")).toBe(true);
    expect(callMatchesSystem("retell_sync", "all")).toBe(true);
    expect(callMatchesSystem(null, "all")).toBe(true);
  });
});
