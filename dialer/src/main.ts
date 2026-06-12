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

  // End-of-day phase stamper removed 2026-06-11 — it was prematurely
  // closing J1/J3/J5 phases for leads that only had 1 or 2 attempts
  // (qualif PAS DE REPONSE / REPONDEUR), so those leads never got their
  // 2nd and 3rd attempts on the same day or the next morning. The
  // sync-lead route already stamps date_jN correctly per call (when
  // attempts reach 3 OR a terminal qualif arrives), so the catch-all was
  // overshooting. Leads with attempts < 3 + non-terminal qualif now stay
  // with date_jN = NULL and get retried in the next slot or next day's
  // morning slot as freshRetries — which is the OCC cadence Wati wants.

  // Reap stale 'dialing' targets. dialTarget flips a target to 'dialing'
  // in-process; if the machine restarts mid-call (deploy, crash), the flip
  // back never happens and the orphan rows permanently occupy concurrency
  // slots — after the June 10 deploy, 4 stale rows == max_concurrency and
  // the whole campaign silently stopped dialing. A live dial never stays
  // in 'dialing' longer than ring(25s)+call; 10 minutes is a safe bound.
  try {
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: reaped } = await sb
      .from("campaign_targets")
      .update({ status: "pending", next_attempt_at: new Date().toISOString() })
      .eq("status", "dialing")
      .lt("last_attempt_at", cutoff)
      .select("id");
    if (reaped && reaped.length > 0) {
      console.warn(`[scheduler] reaped ${reaped.length} stale dialing target(s) back to pending`);
    }
  } catch (e) {
    console.error("[scheduler] stale-dialing reap failed:", (e as Error)?.message);
  }

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
    // ALL campaigns honour the schedule gate, dynamic and static both —
    // Wati saw a call leak out at 10:04 UK while the slot ended at 10:00
    // UK because the dynamic branch bypassed withinSchedule() entirely.
    if (!withinSchedule((c as any).schedule, now)) continue;

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

    let first = true;
    for (const t of due ?? []) {
      // Pace call STARTS to respect the Twilio trunk's CPS limit. Until
      // OCC's Business Profile is approved, Elastic SIP Trunking caps new
      // call setups at 1 CPS per region — firing 5 createSipParticipant
      // in the same tick gets 4 of them rejected (the 82% failed-in-6s
      // storm of June 9). 1.3s spacing keeps us safely under 1 CPS while
      // still allowing max_concurrency simultaneous IN-PROGRESS calls.
      // Tune via DIAL_STAGGER_MS; drop to ~100 once the Business Profile
      // raises the trunk's CPS.
      if (!first) {
        const staggerMs = Math.max(0, Number(process.env.DIAL_STAGGER_MS ?? 1300));
        if (staggerMs > 0) await new Promise((r) => setTimeout(r, staggerMs));
      }
      first = false;
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

  // Twilio price reconciliation, every 30 s — Wati's spec ("toutes les
  // 30 secondes, pas 5 minutes"). Vercel cron's minimum granularity is
  // 1 minute, so we drive it from the long-running dialer worker.
  // CRON_SECRET-gated endpoint reads /Calls.json and PATCHes
  // usage_events with Twilio's real `price` field.
  const twilioSyncIntervalMs = Number(process.env.TWILIO_SYNC_INTERVAL_MS ?? 30_000);
  let twilioSyncTimer: NodeJS.Timeout | undefined;
  if (process.env.APP_URL && process.env.CRON_SECRET) {
    const syncUrl =
      process.env.APP_URL.replace(/\/+$/, "") + "/api/dashboard/sync-twilio?days=2";
    const runTwilioSync = async () => {
      try {
        const res = await fetch(syncUrl, {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) {
          console.warn(`[twilio-sync] HTTP ${res.status}`);
        }
      } catch (e) {
        console.warn(`[twilio-sync] call failed: ${e instanceof Error ? e.message : e}`);
      }
    };
    runTwilioSync(); // fire immediately on boot
    twilioSyncTimer = setInterval(runTwilioSync, twilioSyncIntervalMs);
    console.log(`[twilio-sync] polling every ${twilioSyncIntervalMs}ms`);
  } else {
    console.warn(
      "[twilio-sync] APP_URL or CRON_SECRET missing — skipping in-worker sync (falling back to Vercel cron only)",
    );
  }

  const shutdown = (sig: string) => {
    console.log(`[dialer] received ${sig}, shutting down…`);
    clearInterval(timer);
    if (twilioSyncTimer) clearInterval(twilioSyncTimer);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[dialer] fatal:", err);
  process.exit(1);
});
