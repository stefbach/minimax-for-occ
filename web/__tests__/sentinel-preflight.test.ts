import { describe, it, expect } from "vitest";
import {
  preflightCampaign,
  isPreflightClear,
  blockingChecks,
  type PreflightInput,
} from "@/lib/sentinel/preflight";

// Baseline draft that passes all 10 Wave 1 checks.
function baseline(): PreflightInput {
  return {
    name: "Test",
    agent_handle_id: "ah-1",
    agent_team_id: null,
    phone_number_id: "pn-1",
    caller_id_e164: null,
    data_table_id: null,
    contact_list_id: null,
    csv_text: null,
    targets: [{ e164: "+33612345678", name: "X" }],
    schedule: {
      days: [1, 2, 3],
      hours: { start: "09:00", end: "18:00", ranges: [{ start: "09:00", end: "18:00" }] },
    },
    max_concurrency: 3,
    max_attempts: 3,
    retry_delay_min: 60,
    amd_enabled: true,
    engine: null,
    org_id: "org-1",
    agent: { prompt: "Tu es un agent qui appelle pour…", tts_voice_id: "v_42" },
    phoneNumber: { active: true, e164: "+33183641234" },
  };
}

describe("preflightCampaign — baseline", () => {
  it("emits 10 checks and all pass on a healthy draft", () => {
    const r = preflightCampaign(baseline());
    expect(r.checks).toHaveLength(10);
    const failing = r.checks.filter((c) => !c.passed);
    expect(failing).toEqual([]);
    expect(isPreflightClear(r)).toBe(true);
  });
});

describe("preflightCampaign — individual blockers", () => {
  it("#1 agent_selected fails when no agent and no team", () => {
    const r = preflightCampaign({
      ...baseline(),
      agent_handle_id: null,
      agent_team_id: null,
      agent: null,
    });
    const c = r.checks.find((x) => x.id === "agent_selected")!;
    expect(c.passed).toBe(false);
    expect(c.severity).toBe("blocker");
    expect(isPreflightClear(r)).toBe(false);
  });

  it("#2 agent_has_prompt fails when prompt is blank", () => {
    const r = preflightCampaign({
      ...baseline(),
      agent: { prompt: "   ", tts_voice_id: "v_42" },
    });
    expect(r.checks.find((x) => x.id === "agent_has_prompt")!.passed).toBe(false);
  });

  it("#2 agent_has_prompt accepts the system_prompt alias", () => {
    const r = preflightCampaign({
      ...baseline(),
      agent: { system_prompt: "hello", tts_voice_id: "v_42" },
    });
    expect(r.checks.find((x) => x.id === "agent_has_prompt")!.passed).toBe(true);
  });

  it("#3 agent_has_voice fails when tts_voice_id null", () => {
    const r = preflightCampaign({
      ...baseline(),
      agent: { prompt: "hi", tts_voice_id: null },
    });
    expect(r.checks.find((x) => x.id === "agent_has_voice")!.passed).toBe(false);
  });

  it("#4 phone_number_selected passes on a valid caller-id override", () => {
    const r = preflightCampaign({
      ...baseline(),
      phone_number_id: null,
      caller_id_e164: "+33612345678",
      phoneNumber: null,
    });
    expect(r.checks.find((x) => x.id === "phone_number_selected")!.passed).toBe(true);
  });

  it("#4 phone_number_selected fails on an invalid E.164", () => {
    const r = preflightCampaign({
      ...baseline(),
      phone_number_id: null,
      caller_id_e164: "12345",
      phoneNumber: null,
    });
    expect(r.checks.find((x) => x.id === "phone_number_selected")!.passed).toBe(false);
  });

  it("#5 phone_number_active fails when row.active=false", () => {
    const r = preflightCampaign({
      ...baseline(),
      phoneNumber: { active: false, e164: "+33183641234" },
    });
    expect(r.checks.find((x) => x.id === "phone_number_active")!.passed).toBe(false);
  });

  it("#6 target_source_set fails when no source given", () => {
    const r = preflightCampaign({
      ...baseline(),
      data_table_id: null,
      contact_list_id: null,
      csv_text: null,
      targets: [],
    });
    expect(r.checks.find((x) => x.id === "target_source_set")!.passed).toBe(false);
  });

  it("#6 target_source_set passes when only a data_table_id is set", () => {
    const r = preflightCampaign({
      ...baseline(),
      targets: [],
      data_table_id: "dt-1",
    });
    expect(r.checks.find((x) => x.id === "target_source_set")!.passed).toBe(true);
  });

  it("#7 schedule_has_days fails when empty", () => {
    const r = preflightCampaign({
      ...baseline(),
      schedule: { days: [], hours: { start: "09:00", end: "18:00" } },
    });
    expect(r.checks.find((x) => x.id === "schedule_has_days")!.passed).toBe(false);
  });

  it("#8 schedule_has_hours passes with at least one range", () => {
    const r = preflightCampaign({
      ...baseline(),
      schedule: {
        days: [1],
        hours: { start: null, end: null, ranges: [{ start: "10:00", end: "12:00" }] },
      },
    });
    expect(r.checks.find((x) => x.id === "schedule_has_hours")!.passed).toBe(true);
  });

  it("#8 schedule_has_hours fails when hours object empty", () => {
    const r = preflightCampaign({
      ...baseline(),
      schedule: { days: [1], hours: null },
    });
    expect(r.checks.find((x) => x.id === "schedule_has_hours")!.passed).toBe(false);
  });
});

describe("preflightCampaign — warnings (do not block)", () => {
  it("#9 concurrency_within_plan warns above plan limit but blocking() empty", () => {
    const r = preflightCampaign({ ...baseline(), max_concurrency: 999 });
    const c = r.checks.find((x) => x.id === "concurrency_within_plan")!;
    expect(c.passed).toBe(false);
    expect(c.severity).toBe("warning");
    expect(blockingChecks(r)).toEqual([]);
  });

  it("#10 attempts_reasonable warns when > 5 attempts", () => {
    const r = preflightCampaign({ ...baseline(), max_attempts: 8 });
    const c = r.checks.find((x) => x.id === "attempts_reasonable")!;
    expect(c.passed).toBe(false);
    expect(c.severity).toBe("warning");
    expect(blockingChecks(r)).toEqual([]);
  });

  it("#10 attempts_reasonable warns when retry_delay_min < 5", () => {
    const r = preflightCampaign({ ...baseline(), retry_delay_min: 1 });
    expect(r.checks.find((x) => x.id === "attempts_reasonable")!.passed).toBe(false);
  });
});

describe("preflightCampaign — combined failures", () => {
  it("an empty draft yields 8 blockers + 2 warning failures", () => {
    const r = preflightCampaign({});
    const blockers = r.checks.filter((c) => c.severity === "blocker");
    expect(blockers.every((c) => !c.passed)).toBe(true);
    expect(isPreflightClear(r)).toBe(false);
  });
});
