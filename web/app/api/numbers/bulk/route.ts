import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { hasTwilio, releaseNumber, TwilioApiError } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkAction =
  | "activate"
  | "deactivate"
  | "assign_queue"
  | "assign_agent"
  | "assign_flow"
  | "set_compliance"
  | "delete";

interface BulkBody {
  ids?: string[];
  action?: BulkAction;
  payload?: Record<string, unknown>;
}

/**
 * POST /api/numbers/bulk
 *
 * Body: { ids: string[], action: BulkAction, payload?: object }
 *
 * Mass operations across many phone_numbers rows. For `delete`, we also try
 * to release the underlying Twilio numbers; release failures are reported
 * per-id in `warnings` but never block the DB delete (operators can clean
 * up Twilio manually).
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as BulkBody | null;
  if (!body?.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: "ids requis (tableau non vide)" }, { status: 400 });
  }
  if (!body.action) {
    return NextResponse.json({ error: "action requise" }, { status: 400 });
  }
  if (body.ids.length > 500) {
    return NextResponse.json({ error: "Maximum 500 numéros par opération bulk." }, { status: 400 });
  }

  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const ids = body.ids;
  const payload = body.payload ?? {};
  const warnings: Array<{ id: string; warning: string }> = [];

  switch (body.action) {
    case "activate":
    case "deactivate": {
      const { error, count } = await sb
        .from("phone_numbers")
        .update({ active: body.action === "activate" }, { count: "exact" })
        .eq("org_id", orgId)
        .in("id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, affected: count ?? ids.length });
    }

    case "assign_queue": {
      const queueId = (payload.queue_id ?? null) as string | null;
      const { error, count } = await sb
        .from("phone_numbers")
        .update({ queue_id: queueId }, { count: "exact" })
        .eq("org_id", orgId)
        .in("id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, affected: count ?? ids.length });
    }

    case "assign_agent": {
      const agentId = (payload.agent_handle_id ?? null) as string | null;
      const { error, count } = await sb
        .from("phone_numbers")
        .update({ agent_handle_id: agentId }, { count: "exact" })
        .eq("org_id", orgId)
        .in("id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, affected: count ?? ids.length });
    }

    case "assign_flow": {
      const flowId = (payload.flow_id ?? null) as string | null;
      const { error, count } = await sb
        .from("phone_numbers")
        .update({ flow_id: flowId }, { count: "exact" })
        .eq("org_id", orgId)
        .in("id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, affected: count ?? ids.length });
    }

    case "set_compliance": {
      const patch: Record<string, unknown> = {};
      if ("compliance_jurisdiction" in payload)
        patch.compliance_jurisdiction = payload.compliance_jurisdiction ?? null;
      if ("dnc_check_enabled" in payload)
        patch.dnc_check_enabled = !!payload.dnc_check_enabled;
      if (Object.keys(patch).length === 0) {
        return NextResponse.json(
          { error: "payload doit contenir compliance_jurisdiction et/ou dnc_check_enabled." },
          { status: 400 },
        );
      }
      const { error, count } = await sb
        .from("phone_numbers")
        .update(patch, { count: "exact" })
        .eq("org_id", orgId)
        .in("id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, affected: count ?? ids.length });
    }

    case "delete": {
      // Fetch the rows so we can release SIDs from Twilio. We do this in one
      // round-trip rather than a loop of GETs.
      const { data: rows, error: fetchErr } = await sb
        .from("phone_numbers")
        .select("id, provider, provider_sid")
        .eq("org_id", orgId)
        .in("id", ids);
      if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

      if (hasTwilio()) {
        for (const row of rows ?? []) {
          if (row.provider === "twilio" && row.provider_sid) {
            try {
              await releaseNumber(row.provider_sid);
            } catch (err) {
              const msg =
                err instanceof TwilioApiError
                  ? `Twilio: ${err.message}`
                  : err instanceof Error
                    ? err.message
                    : "Erreur Twilio inconnue";
              warnings.push({ id: row.id, warning: msg });
            }
          }
        }
      } else {
        warnings.push({
          id: "*",
          warning:
            "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN manquants — lignes supprimées mais numéros restent actifs chez Twilio.",
        });
      }

      const { error, count } = await sb
        .from("phone_numbers")
        .delete({ count: "exact" })
        .eq("org_id", orgId)
        .in("id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, affected: count ?? ids.length, warnings });
    }

    default:
      return NextResponse.json({ error: `action inconnue: ${body.action}` }, { status: 400 });
  }
}
