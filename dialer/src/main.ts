import { supabase } from "./supabase.js";
import { dialTarget, type DialJob } from "./dial.js";
import { ensureOutboundTrunkAuth } from "./livekit-trunk.js";
import { ensureInboundDispatchRuleAgent, ensureInboundTrunkKrisp } from "./livekit-dispatch.js";
import { runDynamicSelection } from "./dynamic-selection.js";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 10);

// Active dial count tracked in-memory to respect concurrency without Redis.
let activeDials = 0;

async function scheduleTick() {
  const sb = supabase();
  const { data: campaigns, error } = await sb
    .from("campaigns")
    .select("id,state,max_concurrency,schedule,mode,metadata,data_table_id,org_id")
    .eq("state", "running");
  if (error) {
    console.error("[scheduler] failed to list running campaigns:", error.message);
    return;
  }
  if (!campaigns || campaigns.length === 0) return;

  const now = new Date();
  for (const c of campaigns) {
    // Dynamic (continuous) campaigns re-select leads from their data table at
    // each configured slot, seeding fresh `pending` targets. The dialing loop
    // below then places those calls. Static campaigns skip this entirely.
    if ((c as any).mode === "dynamic") {
      try {
        await runDynamicSelection(sb, {
          id: c.id as string,
          org_id: (c as any).org_id as string,
          data_table_id: (c as any).data_table_id as string | null,
          metadata: (c as any).metadata ?? null,
        }, now);
      } catch (e) {
        console.error(`[scheduler] dynamic selection failed for ${c.id}:`, (e as Error)?.message);
      }
    } else if (!withinSchedule((c as any).schedule, now)) {
      // Static campaigns honour the legacy schedule gate; dynamic ones manage
      // their own slot windows inside runDynamicSelection.
      continue;
    }

    const { count: dialingCount } = await sb
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .eq("status", "dialing");

    const maxConcurrency = Math.min(c.max_concurrency ?? 5, WORKER_CONCURRENCY);
    const slots = Math.max(0, maxConcurrency - (dialingCount ?? 0) - activeDials);
    if (slots === 0) continue;

    const { data: due } = await sb
      .from("campaign_targets")
      .select("id,campaign_id")
      .eq("campaign_id", c.id)
      .eq("status", "pending")
      .not("next_attempt_at", "is", null)
      .lte("next_attempt_at", now.toISOString())
      .limit(slots);

    for (const t of due ?? []) {
      const job: DialJob = { target_id: t.id as string, campaign_id: t.campaign_id as string };
      activeDials++;
      dialTarget(job)
        .catch((err) => console.error(`[dialer] target ${t.id} failed:`, err?.message))
        .finally(() => { activeDials--; });
    }
    if ((due ?? []).length > 0) {
      console.log(`[scheduler] campaign=${c.id} dialing=${(due ?? []).length} active=${activeDials}`);
    }
  }
}

interface Schedule {
  days?: number[];
  // Single legacy range OR an explicit list of ranges (multi-créneaux).
  // When `ranges` is present and non-empty, it takes precedence over the
  // legacy start/end. Times are UTC HH:MM (the wizard converts before sending).
  hours?: {
    start?: string;
    end?: string;
    ranges?: Array<{ start: string; end: string }>;
  };
}

function toMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function withinSchedule(schedule: Schedule | null | undefined, now: Date): boolean {
  if (!schedule) return true;
  const days = schedule.days;
  if (Array.isArray(days) && days.length > 0 && !days.includes(now.getDay())) return false;
  const hours = schedule.hours;
  if (!hours) return true;
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (Array.isArray(hours.ranges) && hours.ranges.length > 0) {
    // ANY range that contains `now` keeps the campaign eligible.
    return hours.ranges.some((r) => {
      const s = toMinutes(r.start);
      const e = toMinutes(r.end);
      return s !== null && e !== null && cur >= s && cur <= e;
    });
  }
  const s = toMinutes(hours.start);
  const e = toMinutes(hours.end);
  if (s !== null && e !== null && (cur < s || cur > e)) return false;
  return true;
}

async function main() {
  console.log(`[dialer] starting — poll=${POLL_INTERVAL_MS}ms concurrency=${WORKER_CONCURRENCY}`);

  // Log + (optionally) enforce the LiveKit outbound trunk SIP auth so the
  // LiveKit→Twilio INVITE stops failing with 403 Forbidden.
  await ensureOutboundTrunkAuth().catch((e) =>
    console.error("[livekit-trunk] startup check error:", e?.message),
  );

  // Make sure the inbound SIP dispatch rule auto-dispatches our agent on
  // every Twilio→LK SIP call so the patient doesn't hear a ringback tone
  // while the agent worker races to join an empty room.
  await ensureInboundDispatchRuleAgent().catch((e) =>
    console.error("[livekit-dispatch] startup check error:", e?.message),
  );

  // Krisp noise cancellation on the inbound trunk so background TV /
  // kids / traffic don't bleed into the STT pipeline.
  await ensureInboundTrunkKrisp().catch((e) =>
    console.error("[livekit-trunk-krisp] startup check error:", e?.message),
  );

  await scheduleTick().catch((e) => console.error("[scheduler] initial tick error:", e));
  const timer = setInterval(() => {
    scheduleTick().catch((e) => console.error("[scheduler] tick error:", e));
  }, POLL_INTERVAL_MS);

  const shutdown = (sig: string) => {
    console.log(`[dialer] received ${sig}, shutting down…`);
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[dialer] fatal:", err);
  process.exit(1);
});
