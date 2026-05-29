import { supabase } from "./supabase.js";
import { dialTarget, type DialJob } from "./dial.js";
import { ensureOutboundTrunkAuth } from "./livekit-trunk.js";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 10);

// Active dial count tracked in-memory to respect concurrency without Redis.
let activeDials = 0;

async function scheduleTick() {
  const sb = supabase();
  const { data: campaigns, error } = await sb
    .from("campaigns")
    .select("id,state,max_concurrency,schedule")
    .eq("state", "running");
  if (error) {
    console.error("[scheduler] failed to list running campaigns:", error.message);
    return;
  }
  if (!campaigns || campaigns.length === 0) return;

  const now = new Date();
  for (const c of campaigns) {
    if (!withinSchedule((c as any).schedule, now)) continue;

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
  hours?: { start?: string; end?: string };
}

function withinSchedule(schedule: Schedule | null | undefined, now: Date): boolean {
  if (!schedule) return true;
  const days = schedule.days;
  if (Array.isArray(days) && days.length > 0 && !days.includes(now.getDay())) return false;
  const hours = schedule.hours;
  if (hours?.start && hours?.end) {
    const [sh, sm] = hours.start.split(":").map(Number);
    const [eh, em] = hours.end.split(":").map(Number);
    const cur = now.getHours() * 60 + now.getMinutes();
    const startM = (sh || 0) * 60 + (sm || 0);
    const endM = (eh || 23) * 60 + (em || 59);
    if (cur < startM || cur > endM) return false;
  }
  return true;
}

async function main() {
  console.log(`[dialer] starting — poll=${POLL_INTERVAL_MS}ms concurrency=${WORKER_CONCURRENCY}`);

  // Log + (optionally) enforce the LiveKit outbound trunk SIP auth so the
  // LiveKit→Twilio INVITE stops failing with 403 Forbidden.
  await ensureOutboundTrunkAuth().catch((e) =>
    console.error("[livekit-trunk] startup check error:", e?.message),
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
