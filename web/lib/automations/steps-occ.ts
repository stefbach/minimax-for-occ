import { type RunCtx, loadCredential } from "./runtime";
import { renderTemplate, type Ctx } from "./templating";
import { analyzeFiles, type AnthropicCred } from "./ai";
import { searchMessages, getMessageAttachments, type GmailCred } from "./gmail";
import { uploadObject, publicUrl, upsertNhsDocument } from "./storage";

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

// ── dispatcher ──────────────────────────────────────────────────────────────

type OccHandler = (rc: RunCtx, step: Record<string, unknown>, ctx: Ctx) => Promise<void>;

const HANDLERS: Record<string, OccHandler> = {
  fetch_patient_context: fetchPatientContext,
  gmail_ingest_documents: gmailIngestDocuments,
};

export async function runOccStep(rc: RunCtx, step: { type: string; [k: string]: unknown }, ctx: Ctx): Promise<boolean> {
  const h = HANDLERS[step.type];
  if (!h) return false;
  await h(rc, step, ctx);
  return true;
}
