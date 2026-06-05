import { describe, it, expect } from "vitest";
import { mapCall, extractTranscript } from "@/lib/retell-sync";
import { bucketForCall } from "@/lib/qualification";

const ORG = "org-1";

describe("mapCall (Retell → Axon calls)", () => {
  it("maps an answered outbound booked call and stamps the qualification", () => {
    const start = Date.UTC(2026, 5, 4, 10, 0, 0);
    const m = mapCall(
      {
        call_id: "ret_1",
        call_status: "ended",
        direction: "outbound",
        from_number: "+2305000000",
        to_number: "+2305748009",
        start_timestamp: start,
        end_timestamp: start + 596_000,
        disconnection_reason: "user_hangup",
        call_analysis: { call_summary: "Booked.", user_sentiment: "positive", custom_analysis_data: { call_outcome: "consultation_booked" } },
        call_cost: { combined_cost: 42 },
      },
      ORG,
    );
    expect(m).not.toBeNull();
    expect(m!.row.direction).toBe("out");
    expect(m!.row.state).toBe("ended");
    expect(m!.row.duration_secs).toBe(596);
    expect(m!.row.answered_at).not.toBeNull();
    expect(m!.row.to_e164).toBe("+2305748009");
    expect(m!.costCents).toBe(42);
    // The Retell outcome must classify like a native Axon call.
    expect(bucketForCall(m!.row)).toBe("rdv_confirme");
  });

  it("treats a short no-answer voicemail as not answered, bucketed via disposition", () => {
    const start = Date.UTC(2026, 5, 4, 11, 0, 0);
    const m = mapCall(
      {
        call_id: "ret_2",
        call_status: "ended",
        direction: "outbound",
        to_number: "+2305000111",
        start_timestamp: start,
        end_timestamp: start + 6_000,
        disconnection_reason: "voicemail",
      },
      ORG,
    );
    expect(m!.row.answered_at).toBeNull();
    expect(bucketForCall(m!.row)).toBe("repondeur");
    expect(m!.costCents).toBeNull();
  });

  it("maps inbound to 'in' and error status to 'failed'", () => {
    const start = Date.UTC(2026, 5, 4, 12, 0, 0);
    const m = mapCall(
      { call_id: "ret_3", call_status: "error", direction: "inbound", start_timestamp: start },
      ORG,
    );
    expect(m!.row.direction).toBe("in");
    expect(m!.row.state).toBe("failed");
  });

  it("skips ongoing calls and rows without a call_id", () => {
    expect(mapCall({ call_id: "x", call_status: "ongoing", start_timestamp: Date.now() }, ORG)).toBeNull();
    expect(mapCall({ call_status: "ended", start_timestamp: Date.now() }, ORG)).toBeNull();
  });

  it("stores the transcript (text + turns) in metadata for the detail view", () => {
    const start = Date.UTC(2026, 5, 4, 13, 0, 0);
    const m = mapCall(
      {
        call_id: "ret_4", call_status: "ended", direction: "outbound",
        to_number: "+2305000222", start_timestamp: start, end_timestamp: start + 30_000,
        transcript: "Agent: Bonjour\nUser: Bonjour",
        transcript_object: [
          { role: "agent", content: "Bonjour" },
          { role: "user", content: "Bonjour, oui ?" },
          { role: "system", content: "ignore me" },
        ],
      },
      ORG,
    );
    expect(m!.row.metadata.transcript_text).toBe("Agent: Bonjour\nUser: Bonjour");
    expect(m!.row.metadata.transcript_turns).toEqual([
      { role: "agent", content: "Bonjour" },
      { role: "user", content: "Bonjour, oui ?" },
    ]);
  });
});

describe("extractTranscript", () => {
  it("returns turns from transcript_object and the flat text", () => {
    const r = extractTranscript({
      transcript: "hello world",
      transcript_object: [
        { role: "agent", content: "Hi" },
        { role: "user", content: "" }, // dropped (empty)
        { role: "user", content: "There" },
      ],
    });
    expect(r.text).toBe("hello world");
    expect(r.turns).toEqual([
      { role: "agent", content: "Hi" },
      { role: "user", content: "There" },
    ]);
  });

  it("yields nulls when nothing usable is present", () => {
    expect(extractTranscript({})).toEqual({ text: null, turns: null });
    expect(extractTranscript({ transcript: "   ", transcript_object: [] })).toEqual({ text: null, turns: null });
  });
});
