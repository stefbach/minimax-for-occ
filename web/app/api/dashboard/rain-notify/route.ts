import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAIN_HANDLE_ID = "a855a4d9-9871-46bb-a109-2abb737d95c3";
const OCC_ORG_ID = "6d2db3ab-6932-42a4-be02-21c6a2f7f9a0";

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(15000),
  });
}

function bar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${pct}%`;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseServer();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  // Rain's calls today
  const { data: rainCalls } = await sb
    .from("calls")
    .select("to_e164, from_e164, duration_secs, disposition")
    .eq("agent_handle_id", RAIN_HANDLE_ID)
    .gte("started_at", todayStart.toISOString())
    .lte("started_at", todayEnd.toISOString());

  const calls = rainCalls ?? [];
  const callByPhone = new Map<string, boolean>();
  for (const c of calls) {
    const phone = (c.to_e164 ?? c.from_e164 ?? "").replace(/\s/g, "");
    if (phone) callByPhone.set(phone, true);
  }

  function countCalled(phones: (string | null)[]): { called: number; total: number } {
    const total = phones.length;
    const called = phones.filter((p) => {
      const clean = (p ?? "").replace(/\s/g, "");
      return clean && callByPhone.has(clean);
    }).length;
    return { called, total };
  }

  // Fetch all 4 mission lists
  const [humainRes, rappelsRes, suivisRes, nhsRes] = await Promise.all([
    sb.from("leads_rdv").select("numero_telephone")
      .eq("qualification", "A PASSER A L'HUMAIN").eq("do_not_call", false),
    sb.from("leads_rdv").select("numero_telephone")
      .eq("qualification", "RAPPEL").eq("do_not_call", false),
    sb.from("leads_rdv").select("numero_telephone")
      .in("qualification", ["SUIVI REQUIS", "SUIVI_REQUIS"]).eq("do_not_call", false),
    sb.from("nhs_dossiers").select("lead_id").eq("submission_ready", false),
  ]);

  const humainPhones = (humainRes.data ?? []).map((r) => r.numero_telephone);
  const rappelsPhones = (rappelsRes.data ?? []).map((r) => r.numero_telephone);
  const suivisPhones = (suivisRes.data ?? []).map((r) => r.numero_telephone);

  // NHS: need to join lead phones
  const nhsLeadIds = (nhsRes.data ?? []).map((d) => d.lead_id).filter(Boolean);
  let nhsPhones: (string | null)[] = [];
  if (nhsLeadIds.length > 0) {
    const { data: nhsLeads } = await sb.from("leads_rdv").select("numero_telephone").in("id", nhsLeadIds);
    nhsPhones = (nhsLeads ?? []).map((l) => l.numero_telephone);
  }

  const h = countCalled(humainPhones);
  const r = countCalled(rappelsPhones);
  const s = countCalled(suivisPhones);
  const n = countCalled(nhsPhones);

  const totalAll = h.total + r.total + s.total + n.total;
  const calledAll = h.called + r.called + s.called + n.called;
  const overallPct = totalAll > 0 ? Math.round((calledAll / totalAll) * 100) : 0;

  const jobDone = overallPct >= 80;
  const verdict = jobDone
    ? "✅ Rain a bien accompli ses missions du jour !"
    : `⚠️ Rain n'a pas terminé toutes ses missions (${overallPct}% complété)`;

  const hPct = h.total > 0 ? Math.round((h.called / h.total) * 100) : 100;
  const rPct = r.total > 0 ? Math.round((r.called / r.total) * 100) : 100;
  const sPct = s.total > 0 ? Math.round((s.called / s.total) * 100) : 100;
  const nPct = n.total > 0 ? Math.round((n.called / n.total) * 100) : 100;

  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "Indian/Mauritius" });

  const message = [
    `📊 <b>Rapport Rain — ${dateStr}</b>`,
    ``,
    verdict,
    ``,
    `<b>Missions du jour :</b>`,
    ``,
    `👤 À l'humain : ${h.called}/${h.total}`,
    `${bar(hPct)}`,
    ``,
    `🔁 Rappels : ${r.called}/${r.total}`,
    `${bar(rPct)}`,
    ``,
    `📋 Suivis : ${s.called}/${s.total}`,
    `${bar(sPct)}`,
    ``,
    `🏥 NHS manquants : ${n.called}/${n.total}`,
    `${bar(nPct)}`,
    ``,
    `<b>Total appels passés aujourd'hui : ${calls.length}</b>`,
    `Répondus (>10s) : ${calls.filter((c) => (c.duration_secs ?? 0) > 10).length}`,
  ].join("\n");

  // Get Telegram credentials for OCC
  const { data: creds } = await sb
    .from("org_credentials")
    .select("data")
    .eq("org_id", OCC_ORG_ID)
    .eq("kind", "telegram")
    .limit(1)
    .maybeSingle();

  if (!creds) {
    return NextResponse.json({ ok: false, error: "no telegram credential found for OCC" });
  }

  const credData = creds.data as { bot_token?: string; chat_id?: string };
  const botToken = credData.bot_token ?? "";
  const chatId = credData.chat_id ?? "";

  if (!botToken || !chatId) {
    return NextResponse.json({ ok: false, error: "telegram credential missing bot_token or chat_id" });
  }

  await sendTelegram(botToken, chatId, message);

  return NextResponse.json({
    ok: true,
    sent: true,
    summary: { humain: h, rappels: r, suivis: s, nhs: n, overall: { called: calledAll, total: totalAll, pct: overallPct } },
  });
}
