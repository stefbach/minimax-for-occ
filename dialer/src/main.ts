import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { supabase } from "./supabase.js";
import { dialTarget, type DialJob } from "./dial.js";

const QUEUE_NAME = "dial-queue";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 10);

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL env var required (e.g. redis://default:pwd@host:6379)");
  return url;
}

function buildConnection() {
  const url = redisUrl();
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    // Upstash requires explicit TLS options when using rediss:// protocol
    ...(url.startsWith("rediss://") && { tls: {} }),
  });
}

/**
 * Scheduler: every POLL_INTERVAL_MS, look at running campaigns and enqueue
 * any pending targets whose next_attempt_at <= now(), respecting each
 * campaign's max_concurrency vs. number already dialing.
 *
 * The schedule window (days + hours) is checked here so we don't dial outside
 * allowed hours.
 */
async function scheduleTick(queue: Queue<DialJob>) {
  const sb = supabase();
  const { data: campaigns, error } = await sb
    .from("campaigns")
    .select(
      "id,state,max_concurrency,schedule",
    )
    .eq("state", "running");
  if (error) {
    console.error("[scheduler] failed to list running campaigns:", error.message);
    return;
  }
  if (!campaigns || campaigns.length === 0) return;

  const now = new Date();
  for (const c of campaigns) {
    if (!withinSchedule((c as any).schedule, now)) continue;

    // Count currently 'dialing' targets to respect concurrency.
    const { count: dialingCount } = await sb
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .eq("status", "dialing");
    const slots = Math.max(0, (c.max_concurrency ?? 5) - (dialingCount ?? 0));
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
      await queue.add(
        "dial",
        { target_id: t.id as string, campaign_id: t.campaign_id as string },
        // jobId dedupes if the scheduler picks the same target twice.
        { jobId: `target:${t.id}`, removeOnComplete: 100, removeOnFail: 500 },
      );
    }
    if ((due ?? []).length > 0) {
      console.log(`[scheduler] campaign=${c.id} enqueued=${(due ?? []).length}`);
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
  console.log("[dialer] starting…");
  const connection = buildConnection();
  const queue = new Queue<DialJob>(QUEUE_NAME, { connection });

  const worker = new Worker<DialJob>(
    QUEUE_NAME,
    async (job: Job<DialJob>) => {
      await dialTarget(job.data);
    },
    { connection: buildConnection(), concurrency: WORKER_CONCURRENCY },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err?.message);
  });
  worker.on("completed", (job) => {
    console.log(`[worker] job ${job.id} done`);
  });

  console.log(`[dialer] worker ready (concurrency=${WORKER_CONCURRENCY}), polling every ${POLL_INTERVAL_MS}ms`);

  // Run an initial tick on boot, then on interval.
  await scheduleTick(queue).catch((e) => console.error("[scheduler] initial tick error:", e));
  const timer = setInterval(() => {
    scheduleTick(queue).catch((e) => console.error("[scheduler] tick error:", e));
  }, POLL_INTERVAL_MS);

  // Graceful shutdown.
  const shutdown = async (sig: string) => {
    console.log(`[dialer] received ${sig}, shutting down…`);
    clearInterval(timer);
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[dialer] fatal:", err);
  process.exit(1);
});
