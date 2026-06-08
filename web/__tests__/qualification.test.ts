import { describe, it, expect } from "vitest";
import { bucketForCall, normalizeQualification } from "@/lib/qualification";

// Locks in the exact behaviour the AI auto-qualification feature targets:
// answered calls whose disposition/qualification map to nothing real land in
// the hidden "autre" bucket and must be surfaced + qualified, never dropped.

describe("bucketForCall", () => {
  it("uses an explicit metadata.qualification first", () => {
    expect(
      bucketForCall({ metadata: { qualification: "consultation_booked" }, answered_at: "x" }),
    ).toBe("rdv_confirme");
  });

  it("falls back to the disposition column", () => {
    expect(bucketForCall({ disposition: "voicemail", answered_at: null })).toBe("repondeur");
  });

  it("routes unanswered calls with an opaque disposition to pas_de_reponse", () => {
    expect(
      bucketForCall({ disposition: "stale_no_terminal_event", answered_at: null }),
    ).toBe("pas_de_reponse");
  });

  it("leaves an ANSWERED call with disposition 'answered' as autre (the gap we fill)", () => {
    expect(bucketForCall({ disposition: "answered", answered_at: "x" })).toBe("autre");
  });

  it("leaves an ANSWERED call with no qualification at all as autre", () => {
    expect(bucketForCall({ disposition: null, metadata: null, answered_at: "x" })).toBe("autre");
  });

  it("does not let a non-autre metadata qualification be overridden by disposition", () => {
    expect(
      bucketForCall({
        metadata: { qualification: "ne pas rappeler" },
        disposition: "rdv confirmé",
        answered_at: "x",
      }),
    ).toBe("ne_pas_rappeler");
  });
});

describe("normalizeQualification", () => {
  it("maps the 9 buckets and unknown text to autre", () => {
    expect(normalizeQualification("rappel demandé")).toBe("rappel");
    expect(normalizeQualification("not interested")).toBe("pas_interesse");
    expect(normalizeQualification("answered")).toBe("autre");
    expect(normalizeQualification(null)).toBe("autre");
  });
});
