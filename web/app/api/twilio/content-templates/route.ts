import { NextResponse } from "next/server";
import { currentMembership } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List the Twilio Content API templates for the platform's Twilio account, so
 * the campaign wizard can offer a dropdown instead of asking the operator to
 * paste a raw Content SID (HX…).
 *
 * Twilio Content templates are channel-agnostic at creation (approval is per
 * channel), so we return every template with a short body preview + the type
 * keys; the wizard shows the same list in both the SMS and WhatsApp pickers
 * and the operator picks the approved one for each channel.
 *
 * GET /api/twilio/content-templates  →  { templates: [...] }
 *
 * Auth: any signed-in member of the org. Twilio credentials are platform-wide
 * (one account for Axon), so there's no per-org scoping on the list itself —
 * we just gate it behind a valid session so it isn't world-readable.
 */
interface TwilioContent {
  sid: string;
  friendly_name: string | null;
  language: string | null;
  variables: Record<string, string> | null;
  types: Record<string, { body?: string | null }> | null;
  date_updated?: string | null;
}

export interface ContentTemplate {
  sid: string;
  friendly_name: string;
  language: string | null;
  /** Ordered variable placeholder names ({{1}}, {{2}}…) as declared on Twilio. */
  variables: string[];
  /** First non-empty body text across the template's content types (preview). */
  body: string | null;
  /** Raw Content type keys, e.g. ["twilio/text"] or ["twilio/card"]. */
  type_keys: string[];
}

export async function GET() {
  const m = await currentMembership();
  if (!m) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return NextResponse.json(
      { error: "Twilio non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).", templates: [] },
      { status: 200 },
    );
  }

  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const out: ContentTemplate[] = [];
  // Twilio paginates the Content list; follow next_page_url, but cap pages so a
  // huge account can't hang the request. ~5 pages × 100 = 500 templates.
  let nextUrl: string | null = "https://content.twilio.com/v1/Content?PageSize=100";
  let pages = 0;
  try {
    while (nextUrl && pages < 5) {
      pages += 1;
      const r: Response = await fetch(nextUrl, { headers: { Authorization: auth } });
      if (!r.ok) {
        // Surface a soft error so the wizard falls back to the manual SID field.
        if (out.length === 0) {
          const txt = await r.text().catch(() => "");
          return NextResponse.json(
            { error: `Twilio ${r.status}: ${txt.slice(0, 200)}`, templates: [] },
            { status: 200 },
          );
        }
        break;
      }
      const j = (await r.json()) as { contents?: TwilioContent[]; meta?: { next_page_url?: string | null } };
      for (const c of j.contents ?? []) {
        const types = c.types ?? {};
        const typeKeys = Object.keys(types);
        let body: string | null = null;
        for (const k of typeKeys) {
          const b = types[k]?.body;
          if (b && b.trim()) { body = b.trim(); break; }
        }
        out.push({
          sid: c.sid,
          friendly_name: c.friendly_name || c.sid,
          language: c.language ?? null,
          variables: c.variables ? Object.keys(c.variables) : [],
          body,
          type_keys: typeKeys,
        });
      }
      nextUrl = j.meta?.next_page_url ?? null;
    }
  } catch (e) {
    if (out.length === 0) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "fetch_failed", templates: [] },
        { status: 200 },
      );
    }
  }

  // Friendly-name sort so the dropdown is predictable.
  out.sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
  return NextResponse.json({ templates: out });
}
