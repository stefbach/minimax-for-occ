import { type RunCtx, loadCredential } from "./runtime";
import { renderTemplate, type Ctx } from "./templating";
import { analyzeFiles, generateText, runAgent, type AnthropicCred } from "./ai";
import { searchMessages, getMessageAttachments, getMessageDetails, sendEmail, createDraft, type GmailCred, type GmailAttachment } from "./gmail";
import { uploadObject, downloadObject, publicUrl, upsertNhsDocument, renderPdf } from "./storage";
import { mirrorDossierPatch, mirrorLeadPatch } from "./nhs-legacy-sync";
import { downloadTwilioMedia } from "./whatsapp-twilio";
import { extractClinicalPrompt, medicalReportPrompt, undueDelayPrompt, s2SubmissionEmailPrompt } from "./prompts-occ";
import { buildComms } from "./comms-occ";
import { sendWhatsAppTemplate, sendWhatsAppFreeform } from "./whatsapp-twilio";

/**
 * OCC patient-pipeline compound steps.
 *
 * Each historical n8n sub-agent maps to one typed step here: the heavy domain
 * logic (inbox scan, content classification, dossier screening, document
 * generation, multi-channel comms) is implemented in TypeScript, while the
 * automation JSON wires which credentials/tables/options to use and pairs it
 * with an ai_brain supervisor. runOccStep returns true when it handled the
 * step type, false to let the engine warn about an unknown type.
 */

// ── Document taxonomy (Agent 3 / Agent 5 / Agent 7) ─────────────────────────

interface Category {
  name: string;
  field: string | null;
}
const CATEGORIES: Category[] = [
  { name: "1. NHS S2 form", field: "doc_nhs_s2_form" },
  { name: "2. S2 Provider Declaration form", field: "doc_s2_provider_declaration" },
  { name: "2bis CPAM Certificate", field: "doc_cpam_certificate" },
  { name: "3. Clinical Justification / Medical History (GP)", field: "doc_clinical_justification_gp" },
  { name: "6. Patient Authorisation Letter", field: "doc_patient_authorisation" },
  { name: "7. Identity Document", field: "doc_identity_document" },
  { name: "8. Proof of residence (UK)", field: "doc_proof_of_residence" },
  { name: "9. Bank statements", field: "doc_bank_statements" },
  { name: "10. Detailed medical estimate", field: "doc_detailed_medical_estimate" },
  { name: "0. To Review", field: null },
];

const CLASSIFY_PROMPT = `You are a document classifier for NHS S2 bariatric surgery applications. Patients attach files with arbitrary, unreliable names, so you MUST identify the document SOLELY from its actual CONTENT (read the attached file) and NEVER from its filename. Decide what the document genuinely is and classify it into EXACTLY ONE category below. If the content does not clearly and confidently match one category, answer '0. To Review'. Respond with ONLY the category name, nothing else.
Categories:
1. NHS S2 form
2. S2 Provider Declaration form
2bis CPAM Certificate
3. Clinical Justification / Medical History (GP) (any GP letter, clinical justification, medical history, patient summary, hospital or clinic letter, or medical records describing the patient's conditions, diagnoses, medications or weight-management history)
6. Patient Authorisation Letter
7. Identity Document
8. Proof of residence (UK) (a UK council tax bill, utility/energy/water bill, tenancy agreement, mortgage statement, or official government or bank letter showing the patient's name and UK residential address)
9. Bank statements (a bank or credit-card account statement showing transactions)
10. Detailed medical estimate
0. To Review`;

function matchCategory(raw: string): Category {
  const low = raw.trim().toLowerCase();
  let cat = CATEGORIES.find((c) => low === c.name.toLowerCase());
  if (!cat) cat = CATEGORIES.find((c) => low.includes(c.name.toLowerCase()));
  if (!cat) {
    const m = raw.match(/(2bis|\d+)/i);
    if (m) {
      const pfx = m[1].toLowerCase();
      cat = CATEGORIES.find(
        (c) => c.name.toLowerCase().startsWith(`${pfx}.`) || c.name.toLowerCase().startsWith(`${pfx} `),
      );
    }
  }
  return cat ?? CATEGORIES[CATEGORIES.length - 1];
}

const VISION_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

// ── helpers ─────────────────────────────────────────────────────────────────

const S = (step: Record<string, unknown>, k: string, ctx: Ctx, dflt = ""): string =>
  renderTemplate(String(step[k] ?? dflt), ctx);

async function cred(rc: RunCtx, id: string | undefined): Promise<Record<string, unknown> | null> {
  return id ? loadCredential(rc, String(id)) : null;
}

function gmailQueryFor(email: string, nom: string): string {
  const e = email.trim().toLowerCase();
  const variants = new Set<string>();
  if (e) {
    variants.add(e);
    const m = e.match(/^(.+)@(gmail\.com|googlemail\.com)$/);
    if (m) {
      variants.add(`${m[1]}@gmail.com`);
      variants.add(`${m[1]}@googlemail.com`);
    }
  }
  const parts = [...variants].map((v) => `from:${v}`);
  return parts.length ? parts.join(" OR ") : e || nom || "";
}

// ── Agent 2: fetch / create the patient context ─────────────────────────────

async function fetchPatientContext(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const leadTable = String(step.table_lead ?? "leads_rdv");
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");
  const patientId = S(step, "patient_id", ctx, "{{patient_id}}") || String(ctx.patient_id ?? ctx.id ?? "");
  if (!patientId) throw new Error("fetch_patient_context: no patient_id");

  const { data: lead } = await rc.ds.client.from(leadTable).select("*").eq("id", patientId).maybeSingle();
  const patient = (lead as Record<string, unknown>) ?? {};

  let { data: dossier } = await rc.ds.client.from(dossierTable).select("*").eq("lead_id", patientId).maybeSingle();
  let created = false;
  if (!dossier) {
    const seed: Record<string, unknown> = {
      lead_id: patientId,
      nom: patient.nom ?? "",
      dossier_status: "NO_DOCUMENTS_RECEIVED",
      dossier_completion_pct: 0,
      documents_generated: false,
      submission_ready: false,
      medical_history_received: false,
    };
    for (const c of CATEGORIES) if (c.field) seed[c.field] = "missing";
    const { data: ins, error } = await rc.ds.client.from(dossierTable).insert(seed).select("*").maybeSingle();
    if (error) throw new Error(`create dossier: ${error.message}`);
    dossier = ins;
    created = true;
  }

  ctx.patient_id = patientId;
  ctx.dossier_id = (dossier as Record<string, unknown>)?.id ?? "";
  ctx.patient = patient;
  ctx.dossier = dossier ?? {};
  ctx.nom = patient.nom ?? (dossier as Record<string, unknown>)?.nom ?? "";
  ctx.email = patient.email ?? "";
  ctx.numero_telephone = patient.numero_telephone ?? "";
  ctx.dossier_created = created;
  rc.stats.actions++;
  rc.log("info", `A2: patient ${ctx.nom || patientId}, dossier ${created ? "created" : "exists"} ${ctx.dossier_id}`);
}

// ── Agent 3: scan inboxes, classify by content, store ───────────────────────

async function gmailIngestDocuments(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const anthropic = (await cred(rc, step.anthropic_credential_id as string)) as AnthropicCred | null;
  if (!anthropic) { rc.log("warn", "A3: anthropic credential missing — skipping"); rc.stats.skipped++; return; }
  const gmailIds = (step.gmail_credential_ids as string[]) ?? [];
  const bucket = String(step.bucket ?? "OCC_Patient");
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");

  const patientId = String(ctx.patient_id ?? "");
  const dossierId = String(ctx.dossier_id ?? "");
  const email = String(ctx.email ?? "");
  const nom = String(ctx.nom ?? "");
  const q = gmailQueryFor(email, nom);

  // Collect attachments across all configured mailboxes, de-duplicated.
  const seen = new Set<string>();
  const atts: Array<{ filename: string; mimeType: string; data: string; source: string }> = [];
  for (const gid of gmailIds) {
    const gc = (await cred(rc, gid)) as GmailCred | null;
    if (!gc) continue;
    const source = String((gc as { sender?: string }).sender ?? gid);
    let ids: string[] = [];
    try { ids = await searchMessages(gc, q, Number(step.max_messages ?? 25)); }
    catch (e) { rc.log("warn", `A3: search ${source} failed: ${e instanceof Error ? e.message : e}`); continue; }
    for (const mid of ids) {
      let list: Awaited<ReturnType<typeof getMessageAttachments>> = [];
      try { list = await getMessageAttachments(gc, mid); } catch { continue; }
      for (const a of list) {
        const ext = (a.filename.split(".").pop() ?? "").toLowerCase();
        if (ext === "ics") continue;
        const key = `${a.filename.toLowerCase()}|${a.data.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        atts.push({ ...a, source });
      }
    }
  }

  const stored: Array<Record<string, unknown>> = [];
  for (const a of atts) {
    // Classify by content (vision); non-visual types go to review.
    let category = CATEGORIES[CATEGORIES.length - 1];
    if (VISION_MIME.has(a.mimeType)) {
      try {
        const verdict = await analyzeFiles({
          cred: anthropic,
          prompt: CLASSIFY_PROMPT,
          attachments: [{ data: a.data, mediaType: a.mimeType, fileName: a.filename }],
          maxTokens: 60,
        });
        category = matchCategory(verdict);
      } catch (e) {
        rc.log("warn", `A3: classify ${a.filename} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    const folder = category.field ?? "to_review";
    const path = `${patientId}/${folder}/${a.filename}`;
    let url = "";
    try {
      url = await uploadObject(rc.ds, bucket, path, Buffer.from(a.data, "base64"), a.mimeType || "application/octet-stream");
    } catch (e) {
      rc.log("error", `A3: upload ${a.filename} failed: ${e instanceof Error ? e.message : e}`);
      rc.stats.errors++;
      continue;
    }
    try {
      await upsertNhsDocument(rc.ds, {
        dossier_id: dossierId || null,
        lead_id: patientId,
        category: category.name,
        doc_field: category.field,
        file_name: a.filename,
        storage_bucket: bucket,
        storage_path: path,
        public_url: url || publicUrl(rc.ds, bucket, path),
        mime_type: a.mimeType,
        source: a.source,
        status: "received",
        classified_by: "axon-agent3",
      });
    } catch (e) {
      rc.log("warn", `A3: record ${a.filename} failed: ${e instanceof Error ? e.message : e}`);
    }
    // Reflect named docs onto the dossier flags immediately.
    if (category.field && dossierId) {
      const docPatch = { [category.field]: "received", [`${category.field}_url`]: url };
      await rc.ds.client.from(dossierTable).update(docPatch).eq("id", dossierId);
      await mirrorDossierPatch(patientId, docPatch);
    }
    stored.push({ filename: a.filename, category: category.name, doc_field: category.field, public_url: url });
    rc.stats.actions++;
  }

  ctx.attachment_count = atts.length;
  ctx.stored_count = stored.length;
  ctx.stored = stored;
  rc.log("info", `A3: ${atts.length} attachments, ${stored.length} stored for ${nom || patientId}`);
}

// ── Agent 8: NHS Response Ingest (reads Dr Nedelcu's mailbox for real NHS
// decisions and writes nhs_submission_status so the dashboard's submitted /
// approved / rejected / in-review / elements-requis counts are driven by
// actual correspondence instead of a manually maintained report) ────────────

const NHS_VERDICT_PROMPT = `You are reading an email that may be a reply from the NHS (or an NHS-commissioning body / ICB) regarding a patient's S2 funded-treatment application for bariatric surgery abroad. Read the email content below and decide which ONE of the following best describes it:
- approved — the NHS has approved / accepted the funding request
- rejected — the NHS has rejected / declined / refused the request
- info_requested — the NHS is asking for additional documents, evidence, or clarification before it can decide
- in_review — the NHS confirms receipt and says the case is under review / being assessed, with no decision yet
- unrelated — this email is not an NHS decision/response about this patient's S2 application at all (e.g. spam, an unrelated automated notice, or a message about a different patient)
Respond with ONLY one of these five words, nothing else.`;

const NHS_VERDICT_TO_STATUS: Record<string, string> = {
  approved: "approved",
  rejected: "rejected",
  info_requested: "info_requested",
  in_review: "in_review",
};

async function gmailIngestNhsResponse(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const anthropic = (await cred(rc, step.anthropic_credential_id as string)) as AnthropicCred | null;
  const nedelcu = (await cred(rc, step.gmail_nedelcu_credential_id as string)) as GmailCred | null;
  if (!anthropic || !nedelcu) { rc.log("warn", "A8: anthropic/nedelcu credential missing — skipping"); rc.stats.skipped++; return; }
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");
  const responsesTable = String(step.table_responses ?? "nhs_response_emails");
  const maxMessages = Number(step.max_messages ?? 15);

  const patientId = String(ctx.patient_id ?? "");
  const dossierId = String(ctx.dossier_id ?? "");
  const nom = String(ctx.nom ?? "").trim();
  const dossier = (ctx.dossier as Record<string, unknown>) ?? {};
  if (!dossierId || !nom) { rc.stats.skipped++; return; }

  // Only auto-process while the status isn't already a terminal human-confirmed
  // decision — avoids an automated re-classification silently overturning a
  // previously approved/rejected outcome.
  const currentStatus = String(dossier.nhs_submission_status ?? "");
  if (currentStatus === "approved" || currentStatus === "rejected") { return; }

  // 1) Detect an actual NHS submission send (vs. just a drafted email) by
  // checking the Sent folder for the cover email this patient's dossier used.
  // Business rule: "En attente NHS" = a submission mail was sent from Dr
  // Nedelcu's inbox to the NHS and no decision has come back yet. We stamp
  // nhs_submission_status='in_review' (which the legacy dashboard view exposes,
  // unlike submission_email_sent) so both "En attente NHS" and "Total dossiers"
  // derive from it. A later decision email (step 2) overwrites this.
  if (!dossier.submission_email_sent) {
    try {
      const sentIds = await searchMessages(nedelcu, `in:sent "${nom}" subject:"NHS S2 Prior Authorisation Application"`, 5);
      if (sentIds.length > 0) {
        const first = await getMessageDetails(nedelcu, sentIds[sentIds.length - 1]);
        const sentAt = new Date(first.internalDateMs).toISOString();
        const sentPatch: Record<string, unknown> = {
          submission_email_sent: true,
          submission_date: sentAt,
          submitted_by: "automation-detected",
          nhs_submission_date: sentAt,
        };
        // Only set in_review if there is not already a real decision on file.
        if (!currentStatus) sentPatch.nhs_submission_status = "in_review";
        await rc.ds.client.from(dossierTable).update(sentPatch).eq("id", dossierId);
        await mirrorDossierPatch(patientId, sentPatch);
        rc.stats.actions++;
        rc.log("info", `A8: detected NHS submission sent for ${nom} → in_review`);
      }
    } catch (e) {
      rc.log("warn", `A8: sent-folder check failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2) Scan for NHS reply emails mentioning this patient, classify each with
  // Claude, and persist the first clear verdict found (new messages only).
  let ids: string[] = [];
  try {
    ids = await searchMessages(nedelcu, `(from:nhs.net OR from:nhs.uk OR from:nhs.scot) "${nom}"`, maxMessages);
  } catch (e) {
    rc.log("warn", `A8: NHS reply search failed: ${e instanceof Error ? e.message : e}`);
    return;
  }

  const { data: seenRows } = await rc.ds.client
    .from(responsesTable)
    .select("message_id")
    .eq("dossier_id", dossierId);
  const seen = new Set(((seenRows ?? []) as Array<{ message_id: string }>).map((r) => r.message_id));

  let verdictApplied: string | null = null;
  for (const mid of ids) {
    if (seen.has(mid)) continue;
    let details;
    try { details = await getMessageDetails(nedelcu, mid); } catch { continue; }
    let verdict = "unrelated";
    try {
      const raw = (
        await generateText({
          cred: anthropic,
          prompt: `${NHS_VERDICT_PROMPT}\n\nSubject: ${details.subject}\nFrom: ${details.from}\nPatient: ${nom}\n\nBody:\n${details.textBody}`,
          maxTokens: 10,
        })
      ).trim().toLowerCase();
      if (raw.includes("approved")) verdict = "approved";
      else if (raw.includes("rejected")) verdict = "rejected";
      else if (raw.includes("info_requested") || raw.includes("info requested")) verdict = "info_requested";
      else if (raw.includes("in_review") || raw.includes("in review")) verdict = "in_review";
    } catch (e) {
      rc.log("warn", `A8: classify message ${mid} failed: ${e instanceof Error ? e.message : e}`);
    }

    await rc.ds.client.from(responsesTable).insert({
      message_id: mid,
      dossier_id: dossierId,
      lead_id: patientId,
      verdict,
      email_date: new Date(details.internalDateMs).toISOString(),
      subject: details.subject.slice(0, 500),
    });
    rc.stats.actions++;

    if (verdict !== "unrelated" && !verdictApplied) {
      const status = NHS_VERDICT_TO_STATUS[verdict] ?? verdict;
      const verdictPatch = {
        nhs_submission_status: status,
        nhs_response_date: new Date(details.internalDateMs).toISOString(),
        nhs_notes: details.textBody.slice(0, 500),
      };
      await rc.ds.client.from(dossierTable).update(verdictPatch).eq("id", dossierId);
      await mirrorDossierPatch(patientId, verdictPatch);
      verdictApplied = status;
      rc.stats.actions++;
    }
  }

  ctx.nhs_response_checked = true;
  ctx.nhs_response_verdict = verdictApplied;
  rc.log("info", `A8: ${ids.length} NHS messages scanned for ${nom}${verdictApplied ? ` → ${verdictApplied}` : ""}`);
}

// ── Agent 9: WhatsApp Ingest (opt-out intent + document attachments) ─────────
// Processes ONE inbound WhatsApp message captured by the Twilio webhook:
//   • "I don't want to continue" → flags the lead as a drop-out ("Abandons")
//   • any attachment → classified + stored like an emailed document ("À
//     soumettre" once the dossier is complete).
// Assumes a preceding fetch_patient_context step resolved ctx.patient_id /
// ctx.dossier_id from the message's matched lead.

const OPT_OUT_PROMPT = `A patient in an NHS S2 bariatric-surgery application programme sent the WhatsApp message below. Decide whether the patient is clearly saying they do NOT want to continue with the application/programme (withdrawing, opting out, "stop", "not interested anymore", "I want to cancel", "please remove me"). A message that just asks a question, sends documents, or is unclear is NOT an opt-out. Answer with exactly one word: YES if it is a clear opt-out, otherwise NO.`;

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

interface InboundMedia { url?: string; content_type?: string }

async function whatsappIngestMessage(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const anthropic = (await cred(rc, step.anthropic_credential_id as string)) as AnthropicCred | null;
  if (!anthropic) { rc.log("warn", "A9: anthropic credential missing — skipping"); rc.stats.skipped++; return; }
  const msgTable = String(step.table_messages ?? "whatsapp_inbound_messages");
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");
  const leadTable = String(step.table_lead ?? "leads_rdv");
  const bucket = String(step.bucket ?? "OCC_Patient");

  const msgId = String(ctx.message_id ?? ctx.id ?? "");
  const patientId = String(ctx.patient_id ?? "");
  const dossierId = String(ctx.dossier_id ?? "");
  const nom = String(ctx.nom ?? "");
  if (!msgId) { rc.stats.skipped++; return; }

  const { data: msg } = await rc.ds.client.from(msgTable).select("*").eq("id", msgId).maybeSingle();
  const message = (msg as Record<string, unknown>) ?? {};
  if (!message.id || message.processed === true) { rc.stats.skipped++; return; }

  const body = String(message.body ?? "").trim();
  const media = (Array.isArray(message.media) ? message.media : []) as InboundMedia[];

  // 1) Opt-out intent → mark the lead as a drop-out (drives "Abandons").
  let optOut = false;
  if (body) {
    try {
      const verdict = (
        await generateText({ cred: anthropic, prompt: `${OPT_OUT_PROMPT}\n\nMessage:\n${body}`, maxTokens: 5 })
      ).trim().toLowerCase();
      optOut = /^yes\b/.test(verdict) || verdict === "yes";
    } catch (e) {
      rc.log("warn", `A9: opt-out classify failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (optOut && patientId) {
    const leadPatch = {
      raison_ne_pas_rappeler: "WhatsApp: le patient ne souhaite pas continuer",
      do_not_call: true,
    };
    await rc.ds.client.from(leadTable).update(leadPatch).eq("id", patientId);
    await mirrorLeadPatch(patientId, leadPatch);
    rc.stats.actions++;
  }

  // 2) Attachments → classify by content + store like an emailed document.
  let stored = 0;
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    if (!m?.url) continue;
    let bytes: Buffer;
    let contentType: string;
    try {
      const dl = await downloadTwilioMedia(m.url);
      bytes = dl.bytes;
      contentType = m.content_type || dl.contentType;
    } catch (e) {
      rc.log("warn", `A9: media download failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const b64 = bytes.toString("base64");
    let category = CATEGORIES[CATEGORIES.length - 1];
    if (VISION_MIME.has(contentType)) {
      try {
        const verdict = await analyzeFiles({
          cred: anthropic,
          prompt: CLASSIFY_PROMPT,
          attachments: [{ data: b64, mediaType: contentType, fileName: `whatsapp-${i}` }],
          maxTokens: 60,
        });
        category = matchCategory(verdict);
      } catch (e) {
        rc.log("warn", `A9: classify media failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    const ext = MIME_EXT[contentType] ?? "bin";
    const fileName = `whatsapp-${msgId}-${i}.${ext}`;
    const folder = category.field ?? "to_review";
    const path = `${patientId}/${folder}/${fileName}`;
    let url = "";
    try {
      url = await uploadObject(rc.ds, bucket, path, bytes, contentType || "application/octet-stream");
    } catch (e) {
      rc.log("error", `A9: upload ${fileName} failed: ${e instanceof Error ? e.message : e}`);
      rc.stats.errors++;
      continue;
    }
    try {
      await upsertNhsDocument(rc.ds, {
        dossier_id: dossierId || null,
        lead_id: patientId,
        category: category.name,
        doc_field: category.field,
        file_name: fileName,
        storage_bucket: bucket,
        storage_path: path,
        public_url: url || publicUrl(rc.ds, bucket, path),
        mime_type: contentType,
        source: "whatsapp",
        status: "received",
        classified_by: "axon-agent9",
      });
    } catch (e) {
      rc.log("warn", `A9: record ${fileName} failed: ${e instanceof Error ? e.message : e}`);
    }
    if (category.field && dossierId) {
      const docPatch = { [category.field]: "received", [`${category.field}_url`]: url };
      await rc.ds.client.from(dossierTable).update(docPatch).eq("id", dossierId);
      await mirrorDossierPatch(patientId, docPatch);
    }
    stored++;
    rc.stats.actions++;
  }

  await rc.ds.client
    .from(msgTable)
    .update({ processed: true, opt_out: optOut, intent: optOut ? "opt_out" : media.length ? "document" : "other" })
    .eq("id", msgId);

  ctx.whatsapp_opt_out = optOut;
  ctx.whatsapp_docs_stored = stored;
  rc.log("info", `A9: ${nom || patientId} msg ${msgId} → opt_out=${optOut}, docs=${stored}`);
}

// ── Agent 5: Supabase Controller (agentic, tool-using) ──────────────────────

async function supabaseControllerAgent(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const anthropic = (await cred(rc, step.anthropic_credential_id as string)) as AnthropicCred | null;
  if (!anthropic) { rc.log("warn", "A5: anthropic credential missing — skipping"); rc.stats.skipped++; return; }
  const docsTable = String(step.table_documents ?? "nhs_documents");
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");
  const patientId = String(ctx.patient_id ?? "");
  const dossierId = String(ctx.dossier_id ?? "");

  const { data: docRows } = await rc.ds.client.from(docsTable).select("*").eq("lead_id", patientId);
  const docs = (docRows ?? []) as Array<Record<string, unknown>>;
  const docSummary = docs.map((d) => ({
    id: d.id, category: d.category, doc_field: d.doc_field, status: d.status, file_name: d.file_name,
  }));
  const dossier = (ctx.dossier as Record<string, unknown>) ?? {};

  const system =
    "You are a meticulous data controller inside an NHS S2 document pipeline. You reason in database logic and act precisely by row id via your Supabase tools. Be conservative: only modify data when confident, never delete, and always explain what you changed.";
  const prompt =
    `You are the OCC Supabase Controller (Agent 5) for ONE patient.\n` +
    `Patient lead_id: ${patientId}\nDossier id: ${dossierId}\n` +
    `Documents on file (${docs.length}): ${JSON.stringify(docSummary)}\n` +
    `Dossier flags: ${JSON.stringify(dossier)}\n\n` +
    `1. Consistency — every received document should map to its dossier doc_* flag; if clearly mis-categorised call reclassify_document.\n` +
    `2. De-duplicate — if the same category appears twice and one is clearly an older copy, call set_document_status to mark the obsolete one 'superseded'.\n` +
    `3. Summary — call set_dossier_notes with a one-line control summary. Do NOT change the dossier status (the Screener does that next).\n` +
    `4. Never delete. Act only when confident; otherwise just report.\n` +
    `Reply starting with 'OK' if consistent, or 'ISSUE: <one sentence>' if a human should look.`;

  const tools = [
    {
      name: "get_documents",
      description: "List nhs_documents rows for a patient lead_id.",
      input_schema: { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"] },
      handler: async (i: Record<string, unknown>) => {
        const { data } = await rc.ds.client.from(docsTable).select("*").eq("lead_id", String(i.lead_id ?? patientId));
        return data ?? [];
      },
    },
    {
      name: "set_document_status",
      description: "Set a document row's status (e.g. superseded).",
      input_schema: { type: "object", properties: { document_id: { type: "string" }, status: { type: "string" } }, required: ["document_id", "status"] },
      handler: async (i: Record<string, unknown>) => {
        const { error } = await rc.ds.client.from(docsTable).update({ status: i.status }).eq("id", i.document_id);
        return error ? { error: error.message } : { ok: true };
      },
    },
    {
      name: "reclassify_document",
      description: "Set a document row's category + doc_field.",
      input_schema: { type: "object", properties: { document_id: { type: "string" }, category: { type: "string" }, doc_field: { type: "string" } }, required: ["document_id", "category", "doc_field"] },
      handler: async (i: Record<string, unknown>) => {
        const { error } = await rc.ds.client.from(docsTable).update({ category: i.category, doc_field: i.doc_field }).eq("id", i.document_id);
        return error ? { error: error.message } : { ok: true };
      },
    },
    {
      name: "set_dossier_notes",
      description: "Write a one-line control summary onto the dossier.",
      input_schema: { type: "object", properties: { dossier_id: { type: "string" }, notes: { type: "string" } }, required: ["dossier_id", "notes"] },
      handler: async (i: Record<string, unknown>) => {
        const { error } = await rc.ds.client.from(dossierTable).update({ ai_analysis_notes: i.notes }).eq("id", String(i.dossier_id ?? dossierId));
        return error ? { error: error.message } : { ok: true };
      },
    },
  ];

  const { output, toolCalls } = await runAgent({ cred: anthropic, system, prompt, tools, maxTokens: 1200, maxTurns: 6 });
  ctx.control_report = output;
  ctx.controller_tool_calls = toolCalls.length;
  ctx.supervisor_status = /^\s*issue/i.test(output) ? "issue" : "ok";
  ctx.supervisor_notes = output || "OK";
  rc.stats.actions++;
  rc.log("info", `A5: controller ran (${toolCalls.length} tool calls) → ${output.slice(0, 80)}`);
}

// ── Agent 7: Screener (completion %, NHS region, status) ────────────────────

const PROBE_FIELDS = [
  "doc_nhs_s2_form", "doc_s2_provider_declaration", "doc_cpam_certificate",
  "doc_clinical_justification_gp", "doc_medical_report", "doc_undue_delay_letter",
  "doc_patient_authorisation", "doc_identity_document", "doc_proof_of_residence",
  "doc_bank_statements", "doc_detailed_medical_estimate",
];
const ACTIVE_DOC_STATUS = new Set(["received", "validated", "signed", "sent"]);
// CPAM Certificate + Detailed Medical Estimate are OCC-supplied standards,
// always counted as present (attached at NHS submission, never asked of the patient).
const OCC_SUPPLIED = new Set(["doc_cpam_certificate", "doc_detailed_medical_estimate"]);

async function screenDossier(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const docsTable = String(step.table_documents ?? "nhs_documents");
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");
  const leadTable = String(step.table_lead ?? "leads_rdv");
  const patientId = String(ctx.patient_id ?? "");
  const dossierId = String(ctx.dossier_id ?? "");
  const dossier = (ctx.dossier as Record<string, unknown>) ?? {};

  const { data: docRows } = await rc.ds.client.from(docsTable).select("*").eq("lead_id", patientId);
  const docs = (docRows ?? []) as Array<Record<string, unknown>>;
  const present = new Set<string>();
  let residenceUrl = "";
  for (const d of docs) {
    const st = String(d.status ?? "").toLowerCase();
    if (d.doc_field && ACTIVE_DOC_STATUS.has(st)) present.add(String(d.doc_field));
    if (d.doc_field === "doc_proof_of_residence" && !residenceUrl) residenceUrl = String(d.public_url ?? "");
  }
  const outDocs: Record<string, string> = {};
  for (const f of PROBE_FIELDS) outDocs[f] = present.has(f) ? "received" : "missing";
  for (const f of OCC_SUPPLIED) outDocs[f] = "received";

  let received = 0;
  for (const f of PROBE_FIELDS) if (outDocs[f] === "received") received++;
  const total = PROBE_FIELDS.length;
  let realReceived = 0;
  for (const f of PROBE_FIELDS) if (outDocs[f] === "received" && !OCC_SUPPLIED.has(f)) realReceived++;
  const status = received === total ? "COMPLETE" : realReceived > 0 ? "MISSING_DOCUMENTS" : "NO_DOCUMENTS_RECEIVED";
  const completionPct = Math.round((received / total) * 100);
  const medicalHistoryReceived = outDocs.doc_clinical_justification_gp === "received";
  const submissionReady = status === "COMPLETE";

  // NHS region: read the residence document once if not already known.
  let region = String(dossier.nhs_region ?? "") || "england";
  const anthropic = (await cred(rc, step.anthropic_credential_id as string)) as AnthropicCred | null;
  if (residenceUrl && !dossier.nhs_region && anthropic) {
    try {
      const file = await downloadObject(rc.ds, residenceUrl);
      if (VISION_MIME.has(file.contentType)) {
        const verdict = (await analyzeFiles({
          cred: anthropic,
          prompt: "This is a UK proof of residence document for an NHS S2 application. Identify which UK nation the residential address is in. Answer with exactly one lowercase word: england, wales, or scotland.",
          attachments: [{ data: file.base64, mediaType: file.contentType }],
          maxTokens: 20,
        })).toLowerCase();
        region = verdict.includes("scotland") ? "scotland" : verdict.includes("wales") ? "wales" : "england";
      }
    } catch (e) {
      rc.log("warn", `A7: region analysis failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Short AI status note.
  let notes = "";
  if (anthropic) {
    try {
      const receivedList = PROBE_FIELDS.filter((f) => outDocs[f] === "received");
      const missingList = PROBE_FIELDS.filter((f) => outDocs[f] === "missing");
      notes = await generateText({
        cred: anthropic,
        prompt:
          `Write 1-2 concise sentences summarising this NHS S2 dossier. Patient: ${ctx.nom ?? ""}. Status: ${status}. ` +
          `Completion: ${completionPct}%. Region: ${region}. Received: ${receivedList.join(", ") || "none"}. ` +
          `Missing: ${missingList.join(", ") || "none"}. Respond with only the summary.`,
        maxTokens: 200,
      });
    } catch { /* best effort */ }
  }
  if (!notes) notes = `Dossier ${status} at ${completionPct}% (${received}/${total} documents).`;

  // Persist to the dossier + sync the lead.
  const dossierPatch: Record<string, unknown> = { ...outDocs };
  dossierPatch.dossier_status = status;
  dossierPatch.dossier_completion_pct = completionPct;
  dossierPatch.nhs_region = region;
  dossierPatch.submission_ready = submissionReady;
  dossierPatch.ai_analysis_notes = notes;
  dossierPatch.medical_history_received = medicalHistoryReceived;
  dossierPatch.last_analysed_at = new Date().toISOString();
  if (dossierId) await rc.ds.client.from(dossierTable).update(dossierPatch).eq("id", dossierId);
  if (patientId) await rc.ds.client.from(leadTable).update({ document_status: status, last_updated: new Date().toISOString() }).eq("id", patientId);
  await mirrorDossierPatch(patientId, dossierPatch);

  ctx.docs = outDocs;
  ctx.dossier_status = status;
  ctx.completion_pct = completionPct;
  ctx.nhs_region = region;
  ctx.submission_ready = submissionReady;
  ctx.medical_history_received = medicalHistoryReceived;
  ctx.ai_analysis_notes = notes;
  rc.stats.actions++;
  rc.log("info", `A7: ${status} ${completionPct}% region=${region} for ${ctx.nom ?? patientId}`);
}

// ── Agent 6: Document Generator (Medical Report + Undue Delay) ───────────────

function gbDate(): string {
  return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

async function generateDocuments(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const anthropic = (await cred(rc, step.anthropic_credential_id as string)) as AnthropicCred | null;
  if (!anthropic) { rc.log("warn", "A6: anthropic credential missing — skipping"); rc.stats.skipped++; return; }
  const bucket = String(step.bucket ?? "OCC_Patient");
  const docsTable = String(step.table_documents ?? "nhs_documents");
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");
  const footer = String(step.footer ?? "Tel: +33 6 95 95 09 65   |   drmariusnedelcu@gmail.com");
  const genModel = step.model ? String(step.model) : undefined;
  const genMaxTokens = Number(step.gen_max_tokens ?? 16000);

  const patientId = String(ctx.patient_id ?? "");
  const dossierId = String(ctx.dossier_id ?? "");
  const nom = String(ctx.nom ?? "Patient");

  // Refresh the dossier and gate on eligibility (S2 + GP letter received,
  // not already generated) — exactly like the n8n "Should Generate?" node.
  const { data: dossier } = await rc.ds.client.from(dossierTable).select("*").eq("id", dossierId).maybeSingle();
  const d = (dossier as Record<string, unknown>) ?? {};
  const eligible =
    d.doc_nhs_s2_form === "received" && d.doc_clinical_justification_gp === "received" && d.documents_generated !== true;
  if (!eligible) {
    ctx.generated_skipped = true;
    ctx.medical_report_url = "";
    ctx.undue_delay_url = "";
    ctx.generated_count = 0;
    rc.log("info", `A6: not eligible / already generated for ${nom} — skipped`);
    return;
  }

  // Build the clinical profile from the S2 form + GP/medical-history docs.
  const { data: docRows } = await rc.ds.client.from(docsTable).select("*").eq("lead_id", patientId).eq("status", "received");
  const docs = (docRows ?? []) as Array<Record<string, unknown>>;
  const sources = docs.filter((r) => {
    const cat = String(r.category ?? "").toLowerCase();
    const df = String(r.doc_field ?? "");
    return (
      String(r.source ?? "") !== "generated" &&
      (df === "doc_nhs_s2_form" ||
        df === "doc_clinical_justification_gp" ||
        cat.includes("medical history") ||
        cat.includes("clinical justification") ||
        cat.includes("patient summ"))
    );
  });

  const parts: string[] = [];
  for (const r of sources) {
    const url = String(r.public_url ?? "");
    if (!url) continue;
    try {
      const file = await downloadObject(rc.ds, url);
      if (!VISION_MIME.has(file.contentType)) continue;
      const txt = (
        await analyzeFiles({
          cred: anthropic,
          prompt: extractClinicalPrompt(String(r.file_name ?? "document")),
          attachments: [{ data: file.base64, mediaType: file.contentType }],
          maxTokens: 4000,
        })
      ).trim();
      if (txt && !/^NO RELEVANT DATA/i.test(txt)) {
        parts.push(`### Source: ${r.file_name ?? "document"} [${r.category ?? ""}]\n${txt}`);
      }
    } catch (e) {
      rc.log("warn", `A6: extract ${r.file_name} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  let profile = parts.join("\n\n");
  if (profile.replace(/\s/g, "").length < 100) {
    profile = `SOURCE DOCUMENTS COULD NOT BE PARSED - generate based on the patient name only and flag this dossier for manual review.\n\n${profile}`;
  }

  // Generate both documents in parallel, then render + store each.
  const dateStr = gbDate();
  const [medMd, undMd] = await Promise.all([
    generateText({ cred: anthropic, prompt: medicalReportPrompt(nom, profile, dateStr), model: genModel, maxTokens: genMaxTokens }),
    generateText({ cred: anthropic, prompt: undueDelayPrompt(nom, profile, dateStr), model: genModel, maxTokens: genMaxTokens }),
  ]);

  const outputs = [
    { md: medMd || `# Medical Report for ${nom}`, file: `COMPREHENSIVE MEDICAL REPORT - ${nom}.pdf`, field: "doc_medical_report", category: "4. Medical Report" },
    { md: undMd || `# Undue Delay Letter for ${nom}`, file: `Undue Delay Letter - ${nom}.pdf`, field: "doc_undue_delay_letter", category: "5. Undue Delay" },
  ];

  const urls: Record<string, string> = {};
  for (const o of outputs) {
    const pdf = await renderPdf(rc.ds, o.md, footer);
    const path = `${patientId}/${o.field}/${o.file}`;
    const url = await uploadObject(rc.ds, bucket, path, pdf, "application/pdf");
    urls[o.field] = url;
    await upsertNhsDocument(rc.ds, {
      dossier_id: dossierId || null,
      lead_id: patientId,
      category: o.category,
      doc_field: o.field,
      file_name: o.file,
      storage_bucket: bucket,
      storage_path: path,
      public_url: url,
      mime_type: "application/pdf",
      source: "generated",
      status: "received",
      classified_by: "axon-agent6",
    });
    rc.stats.actions++;
  }

  const genPatch = {
    doc_medical_report: "received",
    doc_medical_report_url: urls.doc_medical_report,
    doc_undue_delay_letter: "received",
    doc_undue_delay_letter_url: urls.doc_undue_delay_letter,
    documents_generated: true,
    documents_generated_at: new Date().toISOString(),
  };
  await rc.ds.client.from(dossierTable).update(genPatch).eq("id", dossierId);
  await mirrorDossierPatch(patientId, genPatch);

  ctx.generated_skipped = false;
  ctx.medical_report_url = urls.doc_medical_report;
  ctx.undue_delay_url = urls.doc_undue_delay_letter;
  ctx.generated_count = outputs.length;
  rc.log("info", `A6: generated ${outputs.length} documents for ${nom}`);
}

// ── Agent 4: Communicate (status comms + relance + forms/clinic drafts) ──────

// WhatsApp now ships via Twilio (migrated off WATI). These keep their original
// signatures so the communicate step is unchanged; the `cred`/`broadcastName`
// args are ignored and the positional params map onto Twilio ContentVariables.
async function watiSessionMessage(_cred: Record<string, unknown> | null, phone: string, text: string): Promise<void> {
  await sendWhatsAppFreeform(phone, text);
}

async function watiTemplateMessage(
  _cred: Record<string, unknown> | null,
  phone: string,
  templateName: string,
  _broadcastName: string,
  parameters: Array<{ name: string; value: string }>,
): Promise<void> {
  const variables: Record<string, string> = {};
  for (const p of parameters) variables[p.name] = p.value;
  await sendWhatsAppTemplate(phone, templateName, variables);
}

async function telegramSend(cred: Record<string, unknown>, text: string): Promise<void> {
  const token = String(cred.bot_token ?? cred.token ?? "");
  const chatId = String(cred.chat_id ?? "");
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(15000),
  });
}

const NHS_REGION_EMAIL: Record<string, string> = {
  england: "england.europeanhealthcare@nhs.net",
  wales: "nwjcc.ipc@wales.nhs.uk",
  scotland: "loth.safehaven@nhs.scot",
};
const SIGN_KEYMAP: Record<string, string> = {
  s2_form: "doc_nhs_s2_form",
  patient_authorisation: "doc_patient_authorisation",
  s2_provider: "doc_s2_provider_declaration",
};

function dossierDocFlags(d: Record<string, unknown>): Record<string, string> {
  const docs: Record<string, string> = {};
  for (const f of PROBE_FIELDS) docs[f] = String(d[f] ?? "missing");
  return docs;
}

async function communicatePatient(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const stormi = (await cred(rc, step.gmail_stormi_credential_id as string)) as GmailCred | null;
  // WhatsApp ships via Twilio now (env creds) — no WATI credential needed.
  const telegram = step.telegram_credential_id ? await cred(rc, step.telegram_credential_id as string) : null;
  const leadTable = String(step.table_lead ?? "leads_rdv");
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");
  const stdTable = String(step.table_standard_documents ?? "nhs_standard_documents");
  const clinicEmail = String(step.clinic_email ?? "customer.service@obesity-care-clinic.com");
  const draftMode = step.draft_mode === true;
  const mail = draftMode ? createDraft : sendEmail;

  const patientId = String(ctx.patient_id ?? "");
  const dossierId = String(ctx.dossier_id ?? "");
  const { data: lead } = await rc.ds.client.from(leadTable).select("*").eq("id", patientId).maybeSingle();
  const { data: dossier } = await rc.ds.client.from(dossierTable).select("*").eq("id", dossierId).maybeSingle();
  const L = (lead as Record<string, unknown>) ?? {};
  const D = (dossier as Record<string, unknown>) ?? {};
  const nom = String(ctx.nom ?? L.nom ?? D.nom ?? "");
  const email = String(ctx.email ?? L.email ?? "");
  const phone = String(L.numero_telephone ?? ctx.numero_telephone ?? "").replace(/[^0-9]/g, "");
  const status = String(D.dossier_status ?? "NO_DOCUMENTS_RECEIVED");
  const pct = Number(D.dossier_completion_pct ?? 0);
  const region = String(D.nhs_region ?? "england").toLowerCase();
  const docs = dossierDocFlags(D);
  const comms = buildComms({
    nom, status, pct, region, docs,
    medical_report_url: String(D.doc_medical_report_url ?? ""),
    undue_delay_url: String(D.doc_undue_delay_letter_url ?? ""),
  });

  // Relance (J+2) calculation, mirroring the n8n Prepare Comms node.
  const nowIso = new Date().toISOString();
  const firstEmailAt = (L.first_email_at as string) || null;
  const anchor = firstEmailAt || nowIso;
  const days = (Date.now() - Date.parse(anchor)) / 86400000;
  const responded = !!L.last_response_date;
  const alreadyRel = L.relance_email_sent === true;
  const alreadyRelWa = L.relance_whatsapp_sent === true;
  const reminder = status === "NO_DOCUMENTS_RECEIVED" || status === "MISSING_DOCUMENTS";
  const relanceDue = reminder && !responded && !alreadyRel && days >= 2;

  await rc.ds.client.from(leadTable).update({
    document_status: status,
    first_email_at: anchor,
    relance_email_sent: relanceDue ? true : alreadyRel,
    relance_email_date: relanceDue ? nowIso : (L.relance_email_date ?? null),
    relance_whatsapp_sent: relanceDue ? true : alreadyRelWa,
    relance_whatsapp_date: relanceDue ? nowIso : (L.relance_whatsapp_date ?? null),
  }).eq("id", patientId);

  // Status email + WhatsApp to the patient.
  if (stormi && email) {
    const { subject, html } = comms.emailFor(status);
    const pfx = draftMode ? "[DRAFT] " : "";
    try { await mail(stormi, { to: email, subject: pfx + subject, html }); rc.stats.actions++; }
    catch (e) { rc.log("warn", `A4: patient email failed: ${e instanceof Error ? e.message : e}`); }
  }
  if (phone) {
    try {
      if (reminder) {
        // Relance reminder → approved WhatsApp template ({{1}} = first name).
        // Free-form messages only deliver inside the 24h window, which is closed
        // for a non-responding patient, so the reminder must go via a template.
        const template = String(
          step.wati_followup_template ?? "s2_application_documentation_followup__assistance",
        );
        await watiTemplateMessage(null, phone, template, `${template}_${patientId}`, [
          { name: "1", value: nom || "Patient" },
        ]);
      } else {
        await watiSessionMessage(null, phone, comms.waFor(status));
      }
      rc.stats.actions++;
    } catch (e) { rc.log("warn", `A4: WhatsApp failed: ${e instanceof Error ? e.message : e}`); }
  }

  // Forms to sign (S2 / Patient Authorisation) → email to the patient.
  const formsSent: string[] = [];
  if (comms.need_to_sign && stormi && email) {
    const { data: forms } = await rc.ds.client.from(stdTable).select("*").eq("send_for_signing", true).eq("active", true);
    for (const r of (forms ?? []) as Array<Record<string, unknown>>) {
      if (r.recipient !== "patient" || !r.public_url) continue;
      const df = SIGN_KEYMAP[String(r.doc_key)];
      if (df && docs[df] === "received") continue;
      try {
        const f = await downloadObject(rc.ds, String(r.public_url));
        await mail(stormi, {
          to: email,
          subject: `${draftMode ? "[DRAFT] " : ""}Please sign: ${r.title} - NHS S2 application`,
          html: `<p>Dear ${nom},</p><p>Please find attached the <strong>${r.title}</strong> for the NHS S2 application. Kindly complete, sign and return it to customer.service@obesity-care-clinic.com.</p><p>Warm regards,<br>The OCC Patient Services Team</p>`,
          attachments: [{ filename: String(r.file_name ?? `${r.title}.pdf`), mimeType: f.contentType, data: f.base64 }],
        });
        formsSent.push(String(r.doc_key));
        rc.stats.actions++;
      } catch (e) { rc.log("warn", `A4: form ${r.doc_key} failed: ${e instanceof Error ? e.message : e}`); }
    }
  }

  // Clinic-signature draft (Provider Declaration + Devis) once docs generated.
  const docsGenerated = !!(D.doc_medical_report_url && D.doc_undue_delay_letter_url);
  if (docsGenerated && docs.doc_s2_provider_declaration !== "received" && stormi) {
    const { data: stds } = await rc.ds.client.from(stdTable).select("*").eq("active", true);
    const WANT: Record<string, string> = { s2_provider: "S2 Provider Declaration Form", cost_estimate: "Detailed Medical Estimate (Devis)" };
    const atts: GmailAttachment[] = [];
    const lines: string[] = [];
    for (const r of (stds ?? []) as Array<Record<string, unknown>>) {
      const label = WANT[String(r.doc_key)];
      if (!label || !r.public_url) continue;
      try {
        const f = await downloadObject(rc.ds, String(r.public_url));
        atts.push({ filename: String(r.file_name ?? `${label}.pdf`), mimeType: f.contentType, data: f.base64 });
        lines.push(`<li>${label}</li>`);
      } catch { /* skip */ }
    }
    if (atts.length > 0) {
      try {
        await createDraft(stormi, {
          to: clinicEmail,
          subject: `NHS S2 — Documents for Signature — ${nom}`,
          html: `<html><body style='font-family:Arial,sans-serif;color:#333;line-height:1.6;'><p>Dear Clinique Bouchard team,</p><p>Please find attached, for our patient <strong>${nom}</strong>, the following documents relating to the NHS S2 funded-treatment pathway:</p><ul>${lines.join("")}</ul><p>Kindly review and <strong>sign the S2 Provider Declaration Form</strong>, then return the signed copy to us at customer.service@obesity-care-clinic.com.</p><p>With thanks,<br>The OCC Patient Services Team</p></body></html>`,
          attachments: atts,
        });
        rc.stats.actions++;
      } catch (e) { rc.log("warn", `A4: clinic draft failed: ${e instanceof Error ? e.message : e}`); }

      // Notify the OCC team that the clinic sign draft is waiting for review.
      const teamEmail = String(step.team_email ?? step.coordinator_email ?? "customer.service@obesity-care-clinic.com");
      const teamHtml = `<p>Hi team,</p><p>A new patient dossier is ready: the S2 Provider Declaration Form and Detailed Medical Estimate (Devis) for <strong>${nom}</strong> need to be sent to Clinique Bouchard for signature. The generated Medical Report and Undue Delay Letter are in the patient dossier. A draft email to the clinic has been prepared in the mailbox with these documents attached — please review and send it, then upload the signed S2 Provider Declaration when returned.</p>`;
      try {
        await mail(stormi, {
          to: teamEmail,
          subject: `${draftMode ? "[DRAFT] " : ""}Documents Ready for Clinic Signature — ${nom}`,
          html: teamHtml,
        });
        rc.stats.actions++;
      } catch (e) { rc.log("warn", `A4: team notify failed: ${e instanceof Error ? e.message : e}`); }
    }
  }

  if (telegram) {
    try { await telegramSend(telegram, `🗂 NHS Dossier Update\nPatient: ${nom}\nStatus: ${status}\nCompletion: ${pct}%\nRegion: ${region}`); } catch { /* best effort */ }
  }

  ctx.dossier_status = status;
  ctx.completion_pct = pct;
  ctx.nhs_region = region;
  ctx.submission_ready = D.submission_ready === true || status === "COMPLETE";
  ctx.forms_to_sign_sent = formsSent;
  ctx.is_relance_due = relanceDue;
  ctx.email = email;
  ctx.numero_telephone = phone;
  rc.stats.actions++;
  rc.log("info", `A4: ${status} comms for ${nom} (relance=${relanceDue}, forms=${formsSent.length})`);
}

// ── Agent 4b: NHS submission draft (only when the dossier is COMPLETE) ───────

async function prepareNhsSubmission(rc: RunCtx, step: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const submissionReady = ctx.submission_ready === true || ctx.dossier_status === "COMPLETE";
  if (!submissionReady) { ctx.nhs_submission_drafted = false; return; }

  const nedelcu = (await cred(rc, step.gmail_nedelcu_credential_id as string)) as GmailCred | null;
  const stormi = (await cred(rc, step.gmail_stormi_credential_id as string)) as GmailCred | null;
  const anthropic = (await cred(rc, step.anthropic_credential_id as string)) as AnthropicCred | null;
  const dossierTable = String(step.table_dossier ?? "nhs_dossiers");
  const docsTable = String(step.table_documents ?? "nhs_documents");
  const stdTable = String(step.table_standard_documents ?? "nhs_standard_documents");
  const coordinatorEmail = String(step.coordinator_email ?? "customer.service@obesity-care-clinic.com");
  const draftMode = step.draft_mode === true;
  const mail = draftMode ? createDraft : sendEmail;

  const patientId = String(ctx.patient_id ?? "");
  const dossierId = String(ctx.dossier_id ?? "");
  const nom = String(ctx.nom ?? "");
  const { data: dossier } = await rc.ds.client.from(dossierTable).select("*").eq("id", dossierId).maybeSingle();
  const D = (dossier as Record<string, unknown>) ?? {};
  const region = String(D.nhs_region ?? "england").toLowerCase();
  const nhsEmail = String(step.nhs_email_override ?? NHS_REGION_EMAIL[region] ?? NHS_REGION_EMAIL.england);

  // Coordinator notification.
  if (stormi) {
    const comms = buildComms({
      nom, status: "COMPLETE", pct: Number(D.dossier_completion_pct ?? 100), region,
      docs: dossierDocFlags(D),
      medical_report_url: String(D.doc_medical_report_url ?? ""),
      undue_delay_url: String(D.doc_undue_delay_letter_url ?? ""),
    });
    try {
      await mail(stormi, { to: coordinatorEmail, subject: `${draftMode ? "[DRAFT] " : ""}NHS S2 Dossier Ready — ${nom}`, html: comms.html_coordinator });
      rc.stats.actions++;
    } catch (e) { rc.log("warn", `A4b: coordinator email failed: ${e instanceof Error ? e.message : e}`); }
  }

  // Assemble the submission attachments (dossier documents + OCC standards).
  const { data: docRows } = await rc.ds.client.from(docsTable).select("*").eq("dossier_id", dossierId);
  const order = ["doc_nhs_s2_form", "doc_medical_report", "doc_undue_delay_letter", "doc_clinical_justification_gp", "doc_patient_authorisation", "doc_identity_document", "doc_proof_of_residence", "doc_bank_statements"];
  const seen = new Set<string>();
  const picked: Array<{ url: string; file: string }> = [];
  for (const f of order) {
    const r = (docRows ?? []).find((x: Record<string, unknown>) => x.doc_field === f && x.public_url && x.status !== "superseded" && x.source !== "superseded");
    if (r && !seen.has(f)) { seen.add(f); picked.push({ url: String(r.public_url), file: String(r.file_name ?? `${f}.pdf`) }); }
  }
  const { data: stds } = await rc.ds.client.from(stdTable).select("*").eq("active", true);
  const STD_WANT: Record<string, string> = { cpam: "CPAM Certificate", cost_estimate: "Detailed Medical Estimate (Devis)" };
  for (const r of (stds ?? []) as Array<Record<string, unknown>>) {
    const label = STD_WANT[String(r.doc_key)];
    if (label && r.public_url) picked.push({ url: String(r.public_url), file: String(r.file_name ?? `${label}.pdf`) });
  }

  const attachments: GmailAttachment[] = [];
  for (const p of picked) {
    try { const f = await downloadObject(rc.ds, p.url); attachments.push({ filename: p.file, mimeType: f.contentType, data: f.base64 }); }
    catch { /* skip unreachable */ }
  }

  // Generate the formal S2 cover email from the key documents (best effort).
  let coverHtml = `<html><body style='font-family:Calibri,Arial,sans-serif;color:#000;line-height:1.5;'><p>Dear Sir or Madam,</p><p>Please find enclosed an application for prior authorisation of planned treatment under the S2 route (Article 20 of Regulation (EC) No 883/2004) for our patient <strong>${nom}</strong> (NHS region: ${region}).</p><p>Yours faithfully,<br>The OCC Patient Services Team<br>Obesity Care Clinic</p></body></html>`;
  if (anthropic) {
    try {
      const keyDocs = attachments.filter((a) => /S2|MEDICAL REPORT|Undue Delay/i.test(a.filename)).slice(0, 3)
        .map((a) => ({ data: a.data, mediaType: a.mimeType, fileName: a.filename }));
      const llm = await analyzeFiles({ cred: anthropic, prompt: s2SubmissionEmailPrompt(nom), attachments: keyDocs, maxTokens: 24000 });
      const cleaned = llm.replace(/^```(?:html)?/i, "").replace(/```$/i, "").trim();
      if (cleaned.replace(/<[^>]+>/g, "").trim().length >= 500) {
        coverHtml = `<div style='font-family:Calibri,Arial,sans-serif;font-size:11pt;color:rgb(0,0,0);line-height:1.5;'>${cleaned}</div>`;
      }
    } catch (e) { rc.log("warn", `A4b: S2 email generation failed: ${e instanceof Error ? e.message : e}`); }
  }

  // Create the NHS submission DRAFT (reviewed/sent by a human).
  if (nedelcu) {
    try {
      await createDraft(nedelcu, { to: nhsEmail, subject: `NHS S2 Prior Authorisation Application — ${nom}`, html: coverHtml, attachments });
      ctx.nhs_submission_drafted = true;
      rc.stats.actions++;
      rc.log("info", `A4b: NHS submission draft created for ${nom} (${attachments.length} attachments) → ${nhsEmail}`);
    } catch (e) { rc.log("warn", `A4b: NHS draft failed: ${e instanceof Error ? e.message : e}`); ctx.nhs_submission_drafted = false; }
  } else {
    ctx.nhs_submission_drafted = false;
    rc.log("warn", "A4b: Dr Nedelcu mailbox credential missing — no NHS draft");
  }
}

// ── dispatcher ──────────────────────────────────────────────────────────────

type OccHandler = (rc: RunCtx, step: Record<string, unknown>, ctx: Ctx) => Promise<void>;

const HANDLERS: Record<string, OccHandler> = {
  fetch_patient_context: fetchPatientContext,
  gmail_ingest_documents: gmailIngestDocuments,
  supabase_controller_agent: supabaseControllerAgent,
  screen_dossier: screenDossier,
  generate_documents: generateDocuments,
  communicate_patient: communicatePatient,
  prepare_nhs_submission: prepareNhsSubmission,
  gmail_ingest_nhs_response: gmailIngestNhsResponse,
  whatsapp_ingest_message: whatsappIngestMessage,
};

export async function runOccStep(rc: RunCtx, step: { type: string; [k: string]: unknown }, ctx: Ctx): Promise<boolean> {
  const h = HANDLERS[step.type];
  if (!h) return false;
  await h(rc, step, ctx);
  return true;
}
