import { NextResponse } from "next/server";
import { currentUser, currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { sendContentSms } from "@/lib/twilio-sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/test-sms?to=+447360270480&name=Wati
 *
 * One-shot test of the pre-call SMS template (Wati 26/06): sends the approved
 * Twilio Content template `precall_sms_campaign` from +447576562736 to the
 * given number. Owner/admin only (session-gated) so it can't be abused. Open
 * the URL in your browser while logged in.
 */
const ALLOWED = new Set(["super_admin", "owner", "admin"]);
const CONTENT_SID = "HX248b9be8198745c8bc6288b0b0ff8479"; // precall_sms_campaign
const FROM = "+447576562736";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !ALLOWED.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  // Browsers decode a literal "+" in a query string to a space, so "+44…"
  // arrives as " 44…". Normalise: strip spaces and re-add the leading +.
  let to = (url.searchParams.get("to") ?? "").replace(/\s+/g, "");
  if (to && !to.startsWith("+") && /^\d+$/.test(to)) to = "+" + to;
  const name = (url.searchParams.get("name") ?? "Wati").trim();
  if (!/^\+\d{6,15}$/.test(to)) {
    return NextResponse.json({ error: "Paramètre ?to=+E164 requis (ex: ?to=+447360270480)" }, { status: 400 });
  }

  const res = await sendContentSms({
    to,
    from: FROM,
    contentSid: CONTENT_SID,
    variables: { "1": name || "Wati" },
  });
  return NextResponse.json(
    { ...res, to, from: FROM, template: "precall_sms_campaign" },
    { status: res.ok ? 200 : 502 },
  );
}
