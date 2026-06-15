import { type RunCtx, loadCredential } from "./runtime";
import { renderTemplate, type Ctx } from "./templating";
import { analyzeFiles, generateText, runAgent, type AnthropicCred } from "./ai";
import { searchMessages, getMessageAttachments, type GmailCred } from "./gmail";
import { uploadObject, downloadObject, publicUrl, upsertNhsDocument } from "./storage";

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
      await rc.ds.client
        .from(dossierTable)
        .update({ [category.field]: "received", [`${category.field}_url`]: url })
        .eq("id", dossierId);
    }
    stored.push({ filename: a.filename, category: category.name, doc_field: category.field, public_url: url });
    rc.stats.actions++;
  }

  ctx.attachment_count = atts.length;
  ctx.stored_count = stored.length;
  ctx.stored = stored;
  rc.log("info", `A3: ${atts.length} attachments, ${stored.length} stored for ${nom || patientId}`);
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

// ── dispatcher ──────────────────────────────────────────────────────────────

type OccHandler = (rc: RunCtx, step: Record<string, unknown>, ctx: Ctx) => Promise<void>;

const HANDLERS: Record<string, OccHandler> = {
  fetch_patient_context: fetchPatientContext,
  gmail_ingest_documents: gmailIngestDocuments,
  supabase_controller_agent: supabaseControllerAgent,
  screen_dossier: screenDossier,
};

export async function runOccStep(rc: RunCtx, step: { type: string; [k: string]: unknown }, ctx: Ctx): Promise<boolean> {
  const h = HANDLERS[step.type];
  if (!h) return false;
  await h(rc, step, ctx);
  return true;
}
