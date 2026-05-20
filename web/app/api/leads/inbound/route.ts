import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Replay window for HMAC-signed payloads: anything older than this is
 * rejected. 5 minutes is the same threshold most webhook providers use.
 */
const HMAC_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * POST /api/leads/inbound
 *
 * Public endpoint (no Supabase user session) called by n8n connectors after
 * they receive a lead from Google Ads, Facebook Lead Ads, Google Sheets, etc.
 *
 * Authentication is done via a per-connector `secret` looked up in
 * `inbound_webhook_secrets`. That row resolves to an org and (optionally) a
 * default campaign.
 *
 * Body (two accepted shapes):
 *
 *   1) HMAC-signed envelope (preferred):
 *      {
 *        payload:    { secret, e164, ... },   // same fields as the legacy body
 *        signature:  string,                  // hex HMAC-SHA256
 *        timestamp:  number                   // unix ms, must be < 5min old
 *      }
 *      where
 *        signature = HMAC-SHA256(timestamp + JSON.stringify(payload), secret)
 *
 *   2) Legacy (still accepted, logs a warning):
 *      {
 *        secret:       string,                 // matches inbound_webhook_secrets.secret
 *        name?:        string,                 // display name
 *        first_name?:  string,
 *        last_name?:   string,
 *        email?:       string,
 *        e164:         string,                 // required, +E.164 phone
 *        source:       "google_ads" | "facebook_ads" | "google_sheets" | "csv" | "n8n",
 *        metadata?:    Record<string, unknown>,
 *        campaign_id?: string                  // override default campaign
 *      }
 *
 * Behaviour:
 *  1. Resolve secret → org_id (+ default campaign_id).
 *  2. Pick the target campaign:
 *     - explicit `campaign_id` if it belongs to the org, else
 *     - the secret's `campaign_id`, else
 *     - the first running/scheduled campaign of the org.
 *  3. Upsert the contact by (org_id, e164).
 *  4. Decide priority: if the lead's `metadata.lead_created_at` (or `now()`)
 *     is younger than `campaign.speed_to_lead_secs`, priority = 0 (top of
 *     queue); otherwise priority = 5.
 *  5. Upsert a `campaign_targets` row (priority + source + source_metadata).
 *
 * Returns: 201 { target_id, campaign_id, contact_id, priority }.
 */
type LeadPayload = {
  secret?: string; // plain-secret legacy mode
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  e164?: string;
  source?: string;
  metadata?: Record<string, unknown> | null;
  campaign_id?: string;
};

/**
 * Two body shapes are accepted:
 *
 *   1. Legacy (plain secret in the body, kept for backwards compat):
 *      `{ secret, e164, ... }`
 *
 *   2. HMAC-signed (preferred):
 *      `{ payload: { secret, e164, ... }, signature, timestamp }`
 *      where
 *        signature = HMAC-SHA256(timestamp + JSON.stringify(payload), secret)
 *      and `timestamp` is a unix millisecond integer no more than
 *      HMAC_MAX_AGE_MS old. The shared secret is the same
 *      `inbound_webhook_secrets.secret` row used by the legacy flow.
 */
type SignedEnvelope = {
  payload?: LeadPayload;
  signature?: string;
  timestamp?: number | string;
};

type Body = LeadPayload & SignedEnvelope;

function timingSafeEqualString(a: string, b: string): boolean {
  try {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

/**
 * Resolve the actual lead payload + the verification mode. We return either:
 *   - { mode: "hmac", payload }   → caller must still match the secret to find
 *                                    the org, then verify HMAC with that secret
 *   - { mode: "plain", payload }  → plain secret in body (legacy)
 *   - { error }                   → bad request / unauthorized
 */
function unwrapBody(
  body: Body,
): { mode: "hmac"; payload: LeadPayload; signature: string; timestamp: number } |
    { mode: "plain"; payload: LeadPayload } |
    { error: string; status: number } {
  // Signed envelope present?
  if (body.payload && body.signature) {
    const ts = Number(body.timestamp);
    if (!Number.isFinite(ts)) {
      return { error: "timestamp manquant ou invalide", status: 400 };
    }
    const age = Math.abs(Date.now() - ts);
    if (age > HMAC_MAX_AGE_MS) {
      return { error: "timestamp expiré (>5min)", status: 401 };
    }
    return {
      mode: "hmac",
      payload: body.payload,
      signature: body.signature,
      timestamp: ts,
    };
  }
  // Legacy: top-level fields ARE the payload.
  return { mode: "plain", payload: body };
}

function pickName(b: LeadPayload): string | null {
  if (b.name && b.name.trim()) return b.name.trim();
  const parts = [b.first_name, b.last_name]
    .map((s) => (s ?? "").toString().trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

function parseLeadAgeSecs(meta: Record<string, unknown> | null | undefined): number | null {
  if (!meta) return null;
  // Common keys n8n templates will emit (Google Ads "lead_creation_time",
  // Facebook "created_time", generic "lead_created_at").
  for (const k of ["lead_created_at", "lead_creation_time", "created_time", "created_at"]) {
    const v = meta[k];
    if (typeof v === "string" && v) {
      const ts = Date.parse(v);
      if (!Number.isNaN(ts)) {
        return Math.max(0, Math.floor((Date.now() - ts) / 1000));
      }
    }
  }
  return null;
}

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "JSON body requis" }, { status: 400 });

  const unwrapped = unwrapBody(body);
  if ("error" in unwrapped) {
    return NextResponse.json({ error: unwrapped.error }, { status: unwrapped.status });
  }

  const payload = unwrapped.payload;
  const secret = (payload.secret ?? "").trim();
  const e164 = (payload.e164 ?? "").trim();
  if (!secret) return NextResponse.json({ error: "secret manquant" }, { status: 401 });
  if (!e164) return NextResponse.json({ error: "e164 manquant" }, { status: 400 });

  const sb = supabaseServer();

  // 1. Resolve the secret → org + default campaign.
  const { data: hook, error: hookErr } = await sb
    .from("inbound_webhook_secrets")
    .select("id, org_id, campaign_id, enabled")
    .eq("secret", secret)
    .maybeSingle();
  if (hookErr) return NextResponse.json({ error: hookErr.message }, { status: 500 });
  if (!hook || !hook.enabled) {
    return NextResponse.json({ error: "secret invalide" }, { status: 401 });
  }
  const org_id = hook.org_id as string;

  // HMAC verification — only meaningful once we have the secret in hand.
  if (unwrapped.mode === "hmac") {
    const signedData = `${unwrapped.timestamp}${JSON.stringify(payload)}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(signedData)
      .digest("hex");
    if (!timingSafeEqualString(unwrapped.signature, expected)) {
      return NextResponse.json({ error: "signature invalide" }, { status: 401 });
    }
  } else {
    // Plain-secret mode is kept for backwards compatibility but discouraged.
    console.warn(
      "[leads/inbound] plain-secret mode used (no HMAC); migrate this caller to the signed envelope { payload, signature, timestamp } as soon as possible.",
    );
  }

  // 2. Pick campaign.
  let campaign_id: string | null = null;
  if (payload.campaign_id) {
    const { data: c } = await sb
      .from("campaigns")
      .select("id")
      .eq("id", payload.campaign_id)
      .eq("org_id", org_id)
      .maybeSingle();
    if (c) campaign_id = c.id as string;
  }
  if (!campaign_id && hook.campaign_id) {
    campaign_id = hook.campaign_id as string;
  }
  if (!campaign_id) {
    const { data: c } = await sb
      .from("campaigns")
      .select("id, state")
      .eq("org_id", org_id)
      .in("state", ["running", "scheduled", "draft"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (c) campaign_id = c.id as string;
  }
  if (!campaign_id) {
    return NextResponse.json(
      { error: "aucune campagne active pour cette org" },
      { status: 409 },
    );
  }

  // Fetch speed_to_lead window from the chosen campaign.
  const { data: camp } = await sb
    .from("campaigns")
    .select("id, speed_to_lead_secs")
    .eq("id", campaign_id)
    .maybeSingle();
  const speedToLead = Math.max(0, Number(camp?.speed_to_lead_secs ?? 60));

  // 3. Upsert contact.
  const display_name = pickName(payload);
  const email = (payload.email ?? "").trim() || null;
  const { data: contact, error: contactErr } = await sb
    .from("contacts")
    .upsert(
      {
        org_id,
        e164,
        display_name,
        email,
      },
      { onConflict: "org_id,e164" },
    )
    .select("id")
    .single();
  if (contactErr || !contact) {
    return NextResponse.json(
      { error: contactErr?.message ?? "contact upsert failed" },
      { status: 500 },
    );
  }

  // 4. Compute priority.
  const ageSecs = parseLeadAgeSecs(payload.metadata) ?? 0;
  const priority = ageSecs < speedToLead ? 0 : 5;

  // 5. Upsert campaign_target.
  const source = (payload.source ?? "n8n").toString().slice(0, 32);
  const source_metadata = payload.metadata ?? null;

  // Try to insert; if a (campaign_id, contact_id) row already exists, update
  // it in place so the priority / source reflect the latest lead.
  const { data: existing } = await sb
    .from("campaign_targets")
    .select("id, priority")
    .eq("campaign_id", campaign_id)
    .eq("contact_id", contact.id)
    .maybeSingle();

  let target_id: string;
  if (existing) {
    // Promote priority: never demote a row that is already top-priority.
    const nextPriority = Math.min(existing.priority ?? 5, priority);
    const { error: updErr } = await sb
      .from("campaign_targets")
      .update({
        priority: nextPriority,
        source,
        source_metadata,
        status: "pending",
        next_attempt_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    target_id = existing.id as string;
  } else {
    const { data: inserted, error: insErr } = await sb
      .from("campaign_targets")
      .insert({
        campaign_id,
        contact_id: contact.id,
        status: "pending",
        priority,
        source,
        source_metadata,
        next_attempt_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return NextResponse.json(
        { error: insErr?.message ?? "target insert failed" },
        { status: 500 },
      );
    }
    target_id = inserted.id as string;
  }

  return NextResponse.json(
    {
      target_id,
      campaign_id,
      contact_id: contact.id,
      priority,
      speed_to_lead_secs: speedToLead,
      lead_age_secs: ageSecs,
    },
    { status: 201 },
  );
}
