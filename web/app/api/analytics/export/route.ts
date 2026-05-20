import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { csvRow, orgFromAsync, parseRange } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Entity = "calls" | "targets";

function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") ?? "csv").toLowerCase();
  const entity = (searchParams.get("entity") ?? "calls") as Entity;
  const { from, to } = parseRange(req);
  const org_id = await orgFromAsync(req);

  if (format !== "csv") {
    return new Response("only csv supported", { status: 400 });
  }

  if (!hasSupabase()) {
    return csvResponse(`${entity}-empty.csv`, "");
  }

  const sb = supabaseServer();

  if (entity === "calls") {
    const { data, error } = await sb
      .from("calls")
      .select(
        "id, direction, state, from_e164, to_e164, started_at, answered_at, ended_at, duration_secs, disposition, agent_handle_id, queue_id",
      )
      .eq("org_id", org_id)
      .gte("started_at", from.toISOString())
      .lte("started_at", to.toISOString())
      .order("started_at", { ascending: false })
      .limit(50_000);

    if (error) return new Response(error.message, { status: 500 });

    const header = [
      "id",
      "direction",
      "state",
      "from",
      "to",
      "started_at",
      "answered_at",
      "ended_at",
      "duration_secs",
      "disposition",
      "agent_handle_id",
      "queue_id",
    ];
    const lines = [csvRow(header)];
    for (const r of data ?? []) {
      const row = r as Record<string, unknown>;
      lines.push(
        csvRow([
          row.id,
          row.direction,
          row.state,
          row.from_e164,
          row.to_e164,
          row.started_at,
          row.answered_at,
          row.ended_at,
          row.duration_secs,
          row.disposition,
          row.agent_handle_id,
          row.queue_id,
        ]),
      );
    }
    return csvResponse(
      `axon-calls-${from.toISOString().slice(0, 10)}_${to
        .toISOString()
        .slice(0, 10)}.csv`,
      lines.join("\n"),
    );
  }

  if (entity === "targets") {
    // campaign_targets doesn't carry org_id directly — join via campaigns.
    const { data: camps, error: campsErr } = await sb
      .from("campaigns")
      .select("id, name")
      .eq("org_id", org_id);
    if (campsErr) return new Response(campsErr.message, { status: 500 });
    const campMap = new Map<string, string>();
    for (const c of (camps ?? []) as Array<{ id: string; name: string }>) {
      campMap.set(c.id, c.name);
    }
    const ids = Array.from(campMap.keys());
    if (ids.length === 0) {
      return csvResponse(
        "axon-targets-empty.csv",
        csvRow([
          "campaign_id",
          "campaign_name",
          "contact_id",
          "status",
          "attempts",
          "last_attempt_at",
          "next_attempt_at",
          "last_call_id",
        ]),
      );
    }

    const { data, error } = await sb
      .from("campaign_targets")
      .select(
        "campaign_id, contact_id, status, attempts, last_attempt_at, next_attempt_at, last_call_id",
      )
      .in("campaign_id", ids)
      .limit(50_000);
    if (error) return new Response(error.message, { status: 500 });

    const header = [
      "campaign_id",
      "campaign_name",
      "contact_id",
      "status",
      "attempts",
      "last_attempt_at",
      "next_attempt_at",
      "last_call_id",
    ];
    const lines = [csvRow(header)];
    for (const r of data ?? []) {
      const row = r as Record<string, unknown>;
      lines.push(
        csvRow([
          row.campaign_id,
          campMap.get(String(row.campaign_id)) ?? "",
          row.contact_id,
          row.status,
          row.attempts,
          row.last_attempt_at,
          row.next_attempt_at,
          row.last_call_id,
        ]),
      );
    }
    return csvResponse(
      `axon-targets-${from.toISOString().slice(0, 10)}_${to
        .toISOString()
        .slice(0, 10)}.csv`,
      lines.join("\n"),
    );
  }

  return new Response("unknown entity", { status: 400 });
}
