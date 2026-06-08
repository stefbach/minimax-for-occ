import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { fetchRetellCallExtras } from "@/lib/retell-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    .select("recording_url, metadata")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) return new Response("not_found", { status: 404 });

  let url = (data as { recording_url: string | null }).recording_url;
  const meta = ((data as { metadata: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>;

  // Lazy backfill: pull the recording from Retell if we never stored one.
  if (!url && meta.source === "retell_sync" && typeof meta.retell_call_id === "string") {
    const fetched = await fetchRetellCallExtras(meta.retell_call_id);
    if (fetched.recording_url) {
      url = fetched.recording_url;
      await sb.from("calls").update({ recording_url: url }).eq("id", id).eq("org_id", orgId);
    }
  }
  if (!url) return new Response("no_recording", { status: 404 });

  // Forward the browser's Range header so seeking / partial loads work.
  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: range ? { Range: range } : {} });
  } catch {
    return new Response("upstream_unreachable", { status: 502 });
  }
  if (upstream.status >= 400 || !upstream.body) {
    return new Response("upstream_error", { status: 502 });
  }

  const headers = new Headers();
  headers.set("content-type", audioContentType(upstream.headers.get("content-type"), url));
  headers.set("accept-ranges", "bytes");
  const cl = upstream.headers.get("content-length");
  if (cl) headers.set("content-length", cl);
  const cr = upstream.headers.get("content-range");
  if (cr) headers.set("content-range", cr);
  // Private cache: the recording is immutable, but it's PHI-adjacent.
  headers.set("cache-control", "private, max-age=3600");

  return new Response(upstream.body, { status: upstream.status, headers });
}
