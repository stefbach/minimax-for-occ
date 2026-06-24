// POST /api/admin/notify-new-number — one-off "we've moved to a new WhatsApp/SMS
// number" notice to the 29 patients who received a WhatsApp from the old WATI
// number (Premier Contact, template v2_post_agent3_message) before the Twilio
// migration. Sends the approved WhatsApp Content template AND a plain SMS in
// parallel, both from +447700162160.
//
//   # dry run (default) — lists recipients, sends nothing:
//   curl -X POST -H "Authorization: Bearer $NHS_MIGRATION_TOKEN" \
//        -H "Content-Type: application/json" -d '{}' \
//        https://minimax-for-occ.vercel.app/api/admin/notify-new-number
//
//   # real send:
//   curl -X POST -H "Authorization: Bearer $NHS_MIGRATION_TOKEN" \
//        -H "Content-Type: application/json" -d '{"dryRun":false}' \
//        https://minimax-for-occ.vercel.app/api/admin/notify-new-number
//
// Idempotent: rows with new_number_notice_sent_at set are skipped unless
// {"force":true}. A row is marked sent when at least one channel succeeds.

import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase";
import { sendWhatsAppTemplate, sendSms } from "../../../../lib/automations/whatsapp-twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WA_TEMPLATE = "new_whatsapp_number_notice"; // → HX305c25a3d8f083a444add95041649d61

// The 29 confirmed recipients: whatsapp_sent = true via the Premier Contact
// template, de-duped by patient, excluding the relance-only group and the one
// patient already contacted on Twilio (Alamutu Iyamide, 2026-06-23).
const RECIPIENT_IDS: string[] = [
  "70915025-2104-4dcc-be98-7df7bb9c70f1", // Baydon Harbottle
  "fc07489e-5d40-4031-8254-f35a7f4d6fa1", // nicole barrett
  "0aa2526c-6301-41df-8d95-dbbfd21361b3", // ragupathy suntharamoorthy
  "0acf8247-aef3-4539-a936-af2d3502d44f", // nazy lov
  "1e3cd697-4f6b-46e0-9f52-a0f1385fe147", // Kalyani Saraswathi
  "33da8b4e-2f3e-4576-b977-a6a3ce982a31", // Valerie Wilcox
  "38cebee6-992e-48c8-a68c-2f9a4f7996da", // Joleen Whittaker
  "721fc8ff-eae2-4d99-91d1-81bf30f45867", // Amy Burman
  "5cc336ec-5f51-4d7a-840b-80d02c2c2fa5", // Lydia Biyoyo
  "397f0637-6b80-4f20-a7e8-cc20f734f7fd", // Natalie Mcpherson
  "e27ad11a-35dd-4c9a-bf9b-d60b00a2cca6", // Sharon Irving
  "8d3dcfa0-06db-42c7-9eb7-2b53d0b3208b", // Emy Pereira
  "a7e6d234-afd4-4c5b-9891-3f4d561f973c", // Karen Griffin
  "005ac5bf-3556-4020-8e7c-a6919477fd21", // Afua Dufie
  "ab7d6c13-7ddc-44e0-aa97-212498b10974", // alpher sawasawa
  "7499b093-718f-4595-813e-db45ffbf4c40", // Humaira Beg
  "adbd214e-9ebd-4471-be35-7d1611016bfc", // Leonie Wilson
  "1fbadce9-967e-4fe3-8963-76b602867930", // Valerie Osibodu
  "05eb8ab8-349d-411e-b643-774cf5445b9d", // Hadja toure
  "f2507494-1f78-43fe-b040-9b7fb2f4747c", // Stephanie Dellal
  "877bb84e-8650-4202-ac7a-165e4f48a685", // Ivana Orelleno
  "fa35f891-15c7-4146-8fb4-62bd49d3d1c0", // Ashley Gordon
  "086dde5c-5431-44fb-b25c-1ef9a3378e83", // Da Troman
  "9dd9c229-c0dc-41f0-a5b1-8aef2c074fb1", // Claire dale
  "46ee461a-136d-4fa4-a474-918896f2766b", // Amanda Hall
  "6dce6c44-66f6-403a-a1a2-37af4ed5d1be", // Carol Cunningham
  "0e447230-5c58-4583-b002-f42f49844a22", // Christopher Mouse
  "9a8e342f-c9e0-4e05-8ce0-c97d6bcb4e6b", // Hayley Locke
  "2d813997-4513-4ef1-b0fa-ef6d172393cd", // Simon Palmer
];

/** SMS body — mirrors the approved WhatsApp template; {name} → first name. */
function smsBody(firstName: string): string {
  return [
    `Dear ${firstName},`,
    ``,
    `A quick update from your Obesity Care Clinic team.`,
    ``,
    `We've moved to a new WhatsApp number, and this is now the best way to stay in touch with us regarding your NHS bariatric pathway and S2 application.`,
    ``,
    `Please save this number now so you never miss an important update, document request, or milestone in your journey.`,
    ``,
    `Don't worry, you will continue to be supported by the same dedicated team, who will guide you and assist you at every step of your journey.`,
    ``,
    `To confirm you've received this message, simply reply with "Saved"`,
    ``,
    `If you have any questions, we're just a message away.`,
    ``,
    `Warm regards,`,
    ``,
    `Your Obesity Care Clinic Team`,
  ].join("\n");
}

/** First word of `nom`, title-cased: "nicole barrett" → "Nicole". */
function firstNameTitle(nom: string | null): string {
  const first = (nom ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "there";
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

function authOk(req: Request): boolean {
  const want = process.env.NHS_MIGRATION_TOKEN;
  if (!want) return false;
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return !!m && m[1] === want;
}

type RowResult = {
  id: string;
  name: string;
  firstName: string;
  phone: string | null;
  whatsapp: "sent" | "failed" | "skipped";
  sms: "sent" | "failed" | "skipped";
  error?: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { dryRun?: boolean; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → defaults */
  }
  const dryRun = body.dryRun !== false; // default TRUE — must opt in to send
  const force = body.force === true;

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("leads_rdv")
    .select("id, nom, numero_telephone, new_number_notice_sent_at")
    .in("id", RECIPIENT_IDS);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const results: RowResult[] = [];

  for (const row of rows) {
    const firstName = firstNameTitle(row.nom);
    const phone = row.numero_telephone;
    const base: RowResult = {
      id: row.id,
      name: row.nom ?? "",
      firstName,
      phone,
      whatsapp: "skipped",
      sms: "skipped",
    };

    if (!phone) {
      base.error = "no phone number";
      results.push(base);
      continue;
    }
    if (row.new_number_notice_sent_at && !force) {
      base.error = "already notified";
      results.push(base);
      continue;
    }
    if (dryRun) {
      base.whatsapp = "skipped";
      base.sms = "skipped";
      results.push(base);
      continue;
    }

    // Real send — both channels in parallel, independent failure.
    const [wa, sms] = await Promise.allSettled([
      sendWhatsAppTemplate(phone, WA_TEMPLATE, { "1": firstName }),
      sendSms(phone, smsBody(firstName)),
    ]);
    base.whatsapp = wa.status === "fulfilled" ? "sent" : "failed";
    base.sms = sms.status === "fulfilled" ? "sent" : "failed";
    const errs: string[] = [];
    if (wa.status === "rejected") errs.push(`wa: ${String(wa.reason).slice(0, 160)}`);
    if (sms.status === "rejected") errs.push(`sms: ${String(sms.reason).slice(0, 160)}`);
    if (errs.length) base.error = errs.join(" | ");

    if (base.whatsapp === "sent" || base.sms === "sent") {
      await sb
        .from("leads_rdv")
        .update({ new_number_notice_sent_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    results.push(base);
  }

  // Surface any frozen IDs that didn't come back from the DB.
  const found = new Set(rows.map((r) => r.id));
  const missing = RECIPIENT_IDS.filter((id) => !found.has(id));

  const summary = {
    dryRun,
    force,
    requested: RECIPIENT_IDS.length,
    matched: rows.length,
    missing,
    waSent: results.filter((r) => r.whatsapp === "sent").length,
    smsSent: results.filter((r) => r.sms === "sent").length,
    alreadyNotified: results.filter((r) => r.error === "already notified").length,
    failed: results.filter((r) => r.whatsapp === "failed" || r.sms === "failed").length,
  };

  return NextResponse.json({ ok: true, summary, results });
}
