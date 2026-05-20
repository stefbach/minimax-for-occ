import { describe, it, expect } from "vitest";
import {
  countryFromE164,
  prefixForCountry,
  prefixFromE164,
  countryName,
} from "@/lib/phone-utils";

describe("countryFromE164", () => {
  it("detects France from +33", () => {
    expect(countryFromE164("+33756123456")).toBe("FR");
  });

  it("defaults +1 NANP numbers to US", () => {
    expect(countryFromE164("+14155551234")).toBe("US");
  });

  it("resolves longer-prefix countries before shorter ones", () => {
    // +351 (Portugal) must win over a hypothetical +3 catch-all
    expect(countryFromE164("+351912345678")).toBe("PT");
    expect(countryFromE164("+352123456")).toBe("LU");
  });

  it.each([
    ["+44", "GB"],
    ["+49", "DE"],
    ["+34", "ES"],
    ["+39", "IT"],
    ["+31", "NL"],
    ["+32", "BE"],
    ["+41", "CH"],
    ["+353", "IE"],
    ["+230", "MU"],
  ])("maps %s to %s", (prefix, iso) => {
    expect(countryFromE164(prefix + "123456789")).toBe(iso);
  });

  it("returns null for invalid input", () => {
    expect(countryFromE164(null)).toBeNull();
    expect(countryFromE164(undefined)).toBeNull();
    expect(countryFromE164("")).toBeNull();
    expect(countryFromE164("garbage")).toBeNull();
    expect(countryFromE164("0033123456789")).toBeNull(); // missing +
    expect(countryFromE164("+33")).toBeNull(); // too short
    expect(countryFromE164("+9999999999999999")).toBeNull(); // unknown prefix
  });
});

describe("prefixForCountry", () => {
  it("returns the prefix for FR", () => {
    expect(prefixForCountry("FR")).toBe("+33");
  });

  it("is case-insensitive on the ISO code", () => {
    expect(prefixForCountry("fr")).toBe("+33");
    expect(prefixForCountry("Us")).toBe("+1");
  });

  it("returns null for unknown / empty codes", () => {
    expect(prefixForCountry("ZZ")).toBeNull();
    expect(prefixForCountry("")).toBeNull();
    expect(prefixForCountry(null)).toBeNull();
    expect(prefixForCountry(undefined)).toBeNull();
  });
});

describe("prefixFromE164", () => {
  it("round-trips +E.164 → ISO → +prefix", () => {
    expect(prefixFromE164("+33756123456")).toBe("+33");
    expect(prefixFromE164("+14155551234")).toBe("+1");
  });

  it("returns null for invalid numbers", () => {
    expect(prefixFromE164("nope")).toBeNull();
  });
});

describe("countryName", () => {
  it("returns the French display name", () => {
    expect(countryName("FR")).toBe("France");
    expect(countryName("BE")).toBe("Belgique");
  });

  it("returns an em-dash for empty input", () => {
    expect(countryName(null)).toBe("—");
    expect(countryName("")).toBe("—");
  });

  it("returns the raw code for unknown ISOs", () => {
    expect(countryName("zz")).toBe("ZZ");
  });
});
