#!/usr/bin/env node
// NHS migration: upload one file to OCC_Patient storage AND register it in nhs_documents
// (+ patch nhs_dossiers.doc_* columns), idempotently.
//
// Usage:
//   node nhs-migrate-file.mjs '<json-spec>'
// where json-spec = {
//   b64Path, bucket, leadId, dossierId, docField (string|null), category,
//   fileName, contentType
// }
//
// - storage_path = `${leadId}/${docField||'doc_other'}/${fileName}`
// - upserts the storage object (x-upsert)
// - upserts the nhs_documents row keyed on (storage_bucket, storage_path)
// - if docField is one of the 11 canonical dossier columns, sets doc_<field> + doc_<field>_url
import { readFileSync } from 'node:fs';

const envFile = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const url = process.env.NHS_LEGACY_SUPABASE_URL;
const key = process.env.NHS_LEGACY_SERVICE_KEY;
if (!url || !key) { console.error('Missing env'); process.exit(1); }

const DOSSIER_DOC_FIELDS = new Set([
  'doc_nhs_s2_form','doc_s2_provider_declaration','doc_cpam_certificate',
  'doc_clinical_justification_gp','doc_medical_report','doc_undue_delay_letter',
  'doc_patient_authorisation','doc_identity_document','doc_proof_of_residence',
  'doc_bank_statements','doc_detailed_medical_estimate',
]);

// Spec may be passed inline as JSON, or as '@/path/to/spec.json' to avoid shell escaping.
const specArg = process.argv[2] || '';
const spec = JSON.parse(specArg.startsWith('@') ? readFileSync(specArg.slice(1), 'utf8') : specArg);
const { b64Path, bucket, leadId, dossierId, docField, category, fileName, contentType } = spec;
for (const [k, v] of Object.entries({ b64Path, bucket, leadId, dossierId, category, fileName, contentType })) {
  if (!v) { console.error(`Missing spec field: ${k}`); process.exit(1); }
}

// Supabase storage object keys reject non-ASCII chars (e.g. accented "é").
// Sanitize the filename used in the KEY (strip diacritics, replace remaining non-ASCII),
// while keeping the original fileName in the registry for display/identifiability.
function sanitizeKeySeg(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '_');
}
const folder = docField || 'doc_other';
const keyName = sanitizeKeySeg(fileName);
const storagePath = `${leadId}/${folder}/${keyName}`;
const encPath = storagePath.split('/').map(encodeURIComponent).join('/');
const publicUrl = `${url}/storage/v1/object/public/${bucket}/${encPath}`;

const buf = Buffer.from(readFileSync(b64Path, 'utf8').trim(), 'base64');
// Integrity guard: if the caller passes the Drive-reported size, verify the decoded
// bytes match before uploading. Catches the concurrent download-race (crossed tool
// results), truncation, and 0-byte uploads.
if (spec.expectedSize != null && buf.length !== Number(spec.expectedSize)) {
  console.error(`FAIL: size mismatch for ${fileName}: got ${buf.length}, expected ${spec.expectedSize}`);
  process.exit(3);
}

const restHeaders = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

async function main() {
  // 1. Upload storage object (idempotent via x-upsert)
  const up = await fetch(`${url}/storage/v1/object/${bucket}/${encPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buf,
  });
  if (!up.ok) throw new Error(`storage upload ${up.status}: ${(await up.text()).slice(0, 300)}`);

  // 2. Upsert nhs_documents row keyed on (storage_bucket, storage_path)
  const q = `${url}/rest/v1/nhs_documents?storage_bucket=eq.${encodeURIComponent(bucket)}&storage_path=eq.${encodeURIComponent(storagePath)}&select=id`;
  const existing = await (await fetch(q, { headers: restHeaders })).json();
  const row = {
    dossier_id: dossierId, lead_id: leadId, category,
    doc_field: docField || null, file_name: fileName,
    storage_bucket: bucket, storage_path: storagePath, public_url: publicUrl,
    mime_type: contentType, file_size: buf.length,
    source: 'drive-migration', status: 'received', classified_by: 'migration',
  };
  let docId;
  if (Array.isArray(existing) && existing.length) {
    docId = existing[0].id;
    const patch = await fetch(`${url}/rest/v1/nhs_documents?id=eq.${docId}`, {
      method: 'PATCH', headers: { ...restHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    });
    if (!patch.ok) throw new Error(`doc patch ${patch.status}: ${(await patch.text()).slice(0,300)}`);
  } else {
    const ins = await fetch(`${url}/rest/v1/nhs_documents`, {
      method: 'POST', headers: { ...restHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!ins.ok) throw new Error(`doc insert ${ins.status}: ${(await ins.text()).slice(0,300)}`);
    docId = (await ins.json())[0]?.id;
  }

  // 3. Patch dossier doc_<field> columns when this is a canonical field
  if (docField && DOSSIER_DOC_FIELDS.has(docField)) {
    const patch = {}; patch[docField] = fileName; patch[`${docField}_url`] = publicUrl;
    const pd = await fetch(`${url}/rest/v1/nhs_dossiers?id=eq.${dossierId}`, {
      method: 'PATCH', headers: { ...restHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!pd.ok) throw new Error(`dossier patch ${pd.status}: ${(await pd.text()).slice(0,300)}`);
  }

  console.log(JSON.stringify({ ok: true, bytes: buf.length, storagePath, docId, docField: docField || 'doc_other' }));
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(2); });
