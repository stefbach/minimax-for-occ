import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { fetchRetellCallExtras } from "@/lib/retell-sync";
import { fetchTwilioRecordingUrl, findTwilioRecordingForCall } from "@/lib/twilio-recording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Streams a call recording through our own origin instead of linking the
// browser straight at the upstream (Retell CloudFront) URL. Direct playback of
// those URLs fails in the browser for a mix of reasons — CORS, content-type
// served as octet-stream, signed-URL quirks — which is why the player showed
// 0:00 and wouldn't play. Proxying fixes all of them at once: same-origin, a
// real audio/* content-type, and HTTP Range support so the user can seek.
//
// Works for any recording host (Retell now; Twilio/LiveKit later) since it just
// forwards bytes. Falls back to a lazy Retell get-call when the row has no
// recording_url stored yet.

function audioContentType(upstream: string | null, url: string): string {
  if (upstream && upstream.startsWith("audio/")) return upstream;
  const u = url.toLowerCase();
  if (u.includes(".mp3")) return "audio/mpeg";
  if (u.includes(".ogg") || u.includes(".opus")) return "audio/ogg";
  if (u.includes(".m4a") || u.includes(".mp4") || u.includes(".aac")) return "audio/mp4";
  return "audio/wav"; // Retell recordings are .wav
}

export async function GET(request: Request) {
  if (!hasSupabase()) return new Response("supabase_unavailable", { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) return new Response("forbidden", { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("missing_id", { status: 400 });

  const sb = supabaseServer();
  const { data } = await sb
    .from("calls")
    .select("recording_url, metadata, to_e164, from_e164, started_at, answered_at")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) return new Response("not_found", { status: 404 });

  const row = data as { recording_url: string | null; metadata: Record<string, unknown> | null; to_e164: string | null; from_e164: string | null; started_at: string | null; answered_at: string | null };
  let url = row.recording_url;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;

  // Lazy backfill #1: pull the recording from Retell if we never stored one.
  if (!url && meta.source === "retell_sync" && typeof meta.retell_call_id === "string") {
    const fetched = await fetchRetellCallExtras(meta.retell_call_id);
    if (fetched.recording_url) {
      url = fetched.recording_url;
      await sb.from("calls").update({ recording_url: url }).eq("id", id).eq("org_id", orgId);
    }
  }
  // Lazy backfill #2: Twilio Trunk-level recording — Twilio doesn't post a
  // webhook for these, the only way to discover the .mp3 is the Recordings
  // REST API keyed by the call's CallSid. We saved the CallSid into
  // metadata.twilio_call_sid when the agent ran; now we resolve it.
  if (!url && typeof meta.twilio_call_sid === "string" && meta.twilio_call_sid) {
    const fetched = await fetchTwilioRecordingUrl(meta.twilio_call_sid);
    if (fetched) {
      url = fetched;
      await sb.from("calls").update({ recording_url: url }).eq("id", id).eq("org_id", orgId);
    }
  }
  // Lazy backfill #3: Axon/LiveKit call whose row never got a twilio_call_sid
  // (LiveKit + Twilio legs landed on separate rows). Find the Twilio call by
  // number + start time, resolve its recording, and stamp the sid so we don't
  // search again. Only for answered, non-Retell rows with a number + time.
  if (!url && meta.source !== "retell_sync" && !meta.twilio_call_sid && meta.twilio_recording_unavailable !== true
      && row.answered_at && row.started_at) {
    const found = await findTwilioRecordingForCall({
      to: row.to_e164, from: row.from_e164, startedAtMs: Date.parse(row.started_at),
    });
    if (found) {
      url = found.url;
      await sb.from("calls").update({ recording_url: url, metadata: { ...meta, twilio_call_sid: found.sid } }).eq("id", id).eq("org_id", orgId);
    } else {
      await sb.from("calls").update({ metadata: { ...meta, twilio_recording_unavailable: true } }).eq("id", id).eq("org_id", orgId);
    }
  }
  if (!url) return new Response("no_recording", { status: 404 });

  // Twilio's recording .mp3 endpoint requires Basic Auth (and Retell/CloudFront
  // is public). We DON'T forward the browser's Range to the upstream: Twilio
  // transcodes the MP3 on the fly and returns it chunked with no Content-Length
  // and no Range support, so the browser ends up with duration=Infinity and the
  // playhead pinned to the end. Instead we buffer the (small) recording and
  // serve Range requests ourselves with an exact Content-Length, so the player
  // always knows the real duration and can seek.
  const upstreamHeaders: Record<string, string> = {};
  if (url.startsWith("https://api.twilio.com/") && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const tok = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    upstreamHeaders["Authorization"] = `Basic ${tok}`;
  }
  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: upstreamHeaders });
  } catch {
    return new Response("upstream_unreachable", { status: 502 });
  }
  if (upstream.status >= 400 || !upstream.body) {
    return new Response("upstream_error", { status: 502 });
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  const total = buf.length;
  const contentType = audioContentType(upstream.headers.get("content-type"), url);
  const baseHeaders: Record<string, string> = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    // Immutable but PHI-adjacent — private cache only.
    "cache-control": "private, max-age=3600",
  };

  // Partial content for seeking.
  const range = request.headers.get("range");
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m && total > 0) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= total) end = total - 1;
    if (start > end) start = 0;
    const chunk = buf.subarray(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-range": `bytes ${start}-${end}/${total}`,
        "content-length": String(chunk.length),
      },
    });
  }

  return new Response(buf, {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(total) },
  });
}
