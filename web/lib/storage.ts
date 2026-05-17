/**
 * Supabase Storage helpers for Twilio call recordings.
 *
 * The bucket `axon-recordings` is private — see migration
 * 0011_storage_bucket_note.sql for the manual creation step.
 *
 * Layout:
 *   axon-recordings/calls/<call_id>.<ext>
 *
 * We return a signed URL valid 7 days because the bucket is private.  If
 * the operator later flips the bucket to public, `getPublicUrl()` would
 * also work, but signed URLs are the safer default.
 */

import { supabaseServer } from "./supabase";

const BUCKET = "axon-recordings";
const SIGNED_URL_TTL_SECS = 60 * 60 * 24 * 7; // 7 days

function extFromContentType(ct: string | undefined): string {
  if (!ct) return "mp3";
  const t = ct.toLowerCase();
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("webm")) return "webm";
  return "mp3";
}

/**
 * Upload a recording buffer to the `axon-recordings` bucket.
 * Returns a 7-day signed URL (the bucket is private).
 */
export async function uploadRecording(
  buf: Buffer | Uint8Array,
  opts: { call_id: string; content_type?: string },
): Promise<string> {
  const sb = supabaseServer();
  const ext = extFromContentType(opts.content_type);
  const path = `calls/${opts.call_id}.${ext}`;
  const contentType = opts.content_type ?? "audio/mpeg";

  // Convert Buffer to Uint8Array — the supabase-js typings prefer Uint8Array
  // in edge runtimes and accept Buffer at runtime, but Uint8Array is safer.
  const payload =
    buf instanceof Uint8Array && !(buf as any)._isBuffer
      ? buf
      : new Uint8Array(buf);

  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, payload, {
      contentType,
      upsert: true,
    });
  if (upErr) {
    throw new Error(`storage upload failed: ${upErr.message}`);
  }

  const { data: signed, error: signErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECS);
  if (signErr || !signed?.signedUrl) {
    // Fall back to the public URL — works if the operator made the bucket
    // public.  If not, the URL will 400, but we at least return something
    // for the call_events payload.
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    return pub?.publicUrl ?? "";
  }
  return signed.signedUrl;
}

/**
 * Download a Twilio recording (MP3/WAV) using HTTP Basic auth with the
 * Twilio Account SID + Auth Token.  Twilio recording URIs look like:
 *   https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/REyyy
 * Append `.mp3` or `.wav` to force a media format.
 */
export async function downloadTwilioRecording(
  recording_url: string,
): Promise<{ buffer: Buffer; content_type: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      "Twilio credentials missing: set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.",
    );
  }
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(recording_url, {
    headers: { Authorization: auth, Accept: "audio/mpeg, audio/wav, */*" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Twilio recording download failed: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const content_type = res.headers.get("content-type") ?? "audio/mpeg";
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), content_type };
}
