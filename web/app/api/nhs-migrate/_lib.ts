// Shared helpers for the NHS migration endpoint: OAuth, Drive API, Supabase REST.
// Used by /api/nhs-migrate/health and /api/nhs-migrate/run.

export const NHS_FOLDER_ROOT = "1BmS83Qa8CTlOpUL54s7tjwK-9jPI9txA";

export const DOSSIER_DOC_FIELDS = new Set([
  "doc_nhs_s2_form",
  "doc_s2_provider_declaration",
  "doc_cpam_certificate",
  "doc_clinical_justification_gp",
  "doc_medical_report",
  "doc_undue_delay_letter",
  "doc_patient_authorisation",
  "doc_identity_document",
  "doc_proof_of_residence",
  "doc_bank_statements",
  "doc_detailed_medical_estimate",
]);

export type Patient = {
  slug: string;
  leadId: string;
  dossierId: string;
  folderId: string;
};

// Authoritative slug → identity map for the 11 incomplete patients.
// Pulled from the live nhs_dossiers rows on 2026-06-16.
export const PATIENTS: Record<string, Patient> = {
  "mitchell-reece-robinson": { slug: "mitchell-reece-robinson", folderId: "1oWe0HKpxAcABZPQGbYPLNT132PRTof16", leadId: "29160a32-a7a0-4bb7-bb19-0a01c59f738d", dossierId: "e4e1ed16-6a19-4e45-820a-33b623705ae4" },
  "camila-rossi": { slug: "camila-rossi", folderId: "1KBoeojVLa9zgfvpVFahXuL-E0-LaSTpU", leadId: "feb8ce86-f98c-43b2-8a06-76cafcf5d966", dossierId: "5b3ba3bf-d417-4727-b11c-7998fe4b5010" },
  "deborah-ginette-smith": { slug: "deborah-ginette-smith", folderId: "17dxNuDwuzgAjTE6pM8i_kD-sPcSfLlp8", leadId: "2c0c2d75-992d-4505-94ae-f4396254a56d", dossierId: "83af699a-acda-4796-a2ca-8a14aa8a87e9" },
  "amira-mohamoud-mohamed": { slug: "amira-mohamoud-mohamed", folderId: "1sesUjIaCAjO9INI0xbbwmvIvGkjW9QI6", leadId: "5f82f4be-5a31-41e7-b833-c40b3add6559", dossierId: "eb66f688-277c-4621-9850-1d1a785e7062" },
  "ali-alburghol": { slug: "ali-alburghol", folderId: "1ukjD9B-qTTYkDabqmQDWcQutFHMO_pDj", leadId: "a58a2870-6bcf-4997-8a06-379605fa96cd", dossierId: "431308b4-c5e4-4e0f-94e1-e15af6532b3c" },
  "krystal-kemp": { slug: "krystal-kemp", folderId: "18kOpDWzLujSAhbNg8Wdc9uFDf8WgkRA5", leadId: "efd1beb8-716d-4c82-8fc4-a1aa11a77912", dossierId: "b6c901ba-14db-4948-8024-1b3f649d2c0d" },
  "cheryl-marie-tomlinson": { slug: "cheryl-marie-tomlinson", folderId: "1qG_G-X6sloyvGm0nvNb_0xCGJBNeAV7i", leadId: "fb51cd90-a559-41bc-a3da-0494ce3d28a5", dossierId: "f2fdef3a-a7d2-429b-ae11-87a5a48ea1aa" },
  "jaime-pulford": { slug: "jaime-pulford", folderId: "1EzzJb9pi6TyJQOOHlP2UKY6YFwYI9rTu", leadId: "4205a99a-3d61-4a65-9a3b-2578ba003897", dossierId: "f1c496fb-38b0-4883-bb21-18b7aaee9c24" },
  "luriann-alexander-braveboy": { slug: "luriann-alexander-braveboy", folderId: "1PNuVRMJaKLnEXM_fkYQECCpAiPl3KahT", leadId: "386d7da3-36c6-4e0b-bbd3-004db287ed14", dossierId: "98c42055-412c-497e-9aca-c1e53a82ad12" },
  "kyle-bishop": { slug: "kyle-bishop", folderId: "1pBt-XwfTS12bUIpLAOjgnNAp-mt7vhMG", leadId: "405c358a-9ab0-4344-9c8e-8fe6483da11c", dossierId: "44aa067f-a7ed-4d74-a7f5-979385f2f895" },
  "jasmin-mcfarlin": { slug: "jasmin-mcfarlin", folderId: "1oi6C7rl4EubJIc1z4V7jV08lLA6r-2h6", leadId: "deeed231-1b0f-41e3-bea8-30678af75070", dossierId: "539dfd2b-9f35-4761-9523-d64fefa8d096" },
};

export function authOk(req: Request): boolean {
  const want = process.env.NHS_MIGRATION_TOKEN;
  if (!want) return false;
  const hdr = req.headers.get("authorization") ?? "";
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  return !!m && m[1] === want;
}

export function envState() {
  return {
    NHS_LEGACY_SUPABASE_URL: !!process.env.NHS_LEGACY_SUPABASE_URL,
    NHS_LEGACY_SERVICE_KEY: !!process.env.NHS_LEGACY_SERVICE_KEY,
    NHS_MIGRATION_TOKEN: !!process.env.NHS_MIGRATION_TOKEN,
    GOOGLE_OAUTH_CLIENT_ID: !!process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: !!process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REFRESH_TOKEN: !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  };
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

export async function googleAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.value;
  }
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`oauth token exchange ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    value: j.access_token,
    expiresAt: now + j.expires_in * 1000,
  };
  return j.access_token;
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
};

export async function driveList(folderId: string, token: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,size,parents)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`drive list ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
    out.push(...j.files);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

export async function driveDownload(fileId: string, token: string): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`drive download ${fileId} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const ab = await res.arrayBuffer();
  return { buf: Buffer.from(ab), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

// Supabase storage keys reject non-ASCII. Strip diacritics + replace other non-printables.
export function sanitizeKeySeg(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\x20-\x7E]/g, "_");
}

// Map a Drive subfolder title to docField + category. Title-based (not token-based)
// so it tolerates Drive folders whose leading number disagrees with content
// (e.g. jaime's "8. Bank Statements" / "9. Proof of residence" swap).
export function mapFolderTitleToDocField(title: string): { docField: string | null; category: string } {
  const t = title.toLowerCase();
  // Order matters: more specific keywords first.
  if (t.includes("nhs s2") || /(^|\s)s2 form\b/.test(t) || /^1[\.\s]/.test(title) && t.includes("s2")) {
    return { docField: "doc_nhs_s2_form", category: "1. NHS S2 form" };
  }
  if (t.includes("s2 provider")) return { docField: "doc_s2_provider_declaration", category: "2. S2 Provider Declaration" };
  if (t.includes("cpam")) return { docField: "doc_cpam_certificate", category: "2bis. CPAM Certificate" };
  if (t.includes("clinical justification") || t.includes("clinical justifiation") || t.includes("justification letter") || t.includes("medical history")) {
    return { docField: "doc_clinical_justification_gp", category: "3. Clinical Justification / Medical History (GP)" };
  }
  if (t.includes("medical report")) return { docField: "doc_medical_report", category: "4. Medical Report" };
  if (t.includes("undue delay")) return { docField: "doc_undue_delay_letter", category: "5. Undue Delay" };
  if (t.includes("patient authoris") || t.includes("patient authoriz")) return { docField: "doc_patient_authorisation", category: "6. Patient Authorisation Letter" };
  if (t.includes("identity")) return { docField: "doc_identity_document", category: "7. Identity Document" };
  if (t.includes("proof of residence") || t.includes("proof of residency")) return { docField: "doc_proof_of_residence", category: "8. Proof of residence (UK)" };
  if (t.includes("bank statement")) return { docField: "doc_bank_statements", category: "9. Bank statements" };
  if (t.includes("medical estimate") || t.includes("detailed medical")) return { docField: "doc_detailed_medical_estimate", category: "10. Detailed Medical Estimate" };
  return { docField: null, category: title };
}

const isFolderMime = (m: string) => m === "application/vnd.google-apps.folder";

// Recursively walk a patient's folder. Each yielded file carries the docField/category
// of its top-level numbered ancestor (so files in nested "Clinique Bouchard/Phase 1"
// inherit the parent folder's classification).
export type WalkedFile = {
  file: DriveFile;
  docField: string | null;
  category: string;
};

export async function walkPatientFolder(
  rootFolderId: string,
  token: string,
): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const top = await driveList(rootFolderId, token);
  // Loose files at patient root → doc_other.
  for (const f of top) {
    if (!isFolderMime(f.mimeType)) {
      out.push({ file: f, docField: null, category: f.name });
    }
  }
  // Process top-level subfolders; classification is fixed at this level
  // and inherited by all descendants.
  for (const sub of top) {
    if (!isFolderMime(sub.mimeType)) continue;
    const { docField, category } = mapFolderTitleToDocField(sub.name);
    await walkDescendants(sub.id, token, docField, category, out);
  }
  return out;
}

async function walkDescendants(
  folderId: string,
  token: string,
  docField: string | null,
  category: string,
  out: WalkedFile[],
): Promise<void> {
  const children = await driveList(folderId, token);
  for (const c of children) {
    if (isFolderMime(c.mimeType)) {
      await walkDescendants(c.id, token, docField, category, out);
    } else {
      out.push({ file: c, docField, category });
    }
  }
}

export type UploadResult = {
  fileId: string;
  fileName: string;
  docField: string | null;
  bytes: number;
  storagePath: string;
  publicUrl: string;
  registryId: string;
  uploaded: boolean;
};

export async function uploadAndRegister(opts: {
  buf: Buffer;
  contentType: string;
  bucket: string;
  leadId: string;
  dossierId: string;
  docField: string | null;
  category: string;
  fileName: string;
  fileId: string;
}): Promise<UploadResult> {
  const url = process.env.NHS_LEGACY_SUPABASE_URL!;
  const key = process.env.NHS_LEGACY_SERVICE_KEY!;
  const folder = opts.docField ?? "doc_other";
  const safeName = sanitizeKeySeg(opts.fileName);
  const storagePath = `${opts.leadId}/${folder}/${safeName}`;
  const encPath = storagePath.split("/").map(encodeURIComponent).join("/");
  const publicUrl = `${url}/storage/v1/object/public/${opts.bucket}/${encPath}`;

  const up = await fetch(`${url}/storage/v1/object/${opts.bucket}/${encPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": opts.contentType,
      "x-upsert": "true",
    },
    body: opts.buf as unknown as BodyInit,
  });
  if (!up.ok) throw new Error(`storage upload ${up.status}: ${(await up.text()).slice(0, 300)}`);

  const restHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const row = {
    dossier_id: opts.dossierId,
    lead_id: opts.leadId,
    category: opts.category,
    doc_field: opts.docField,
    file_name: opts.fileName,
    storage_bucket: opts.bucket,
    storage_path: storagePath,
    public_url: publicUrl,
    mime_type: opts.contentType,
    file_size: opts.buf.length,
    source: "drive-migration-vercel",
    status: "received",
    classified_by: "migration",
  };
  // Upsert keyed on (storage_bucket, storage_path).
  const existingRes = await fetch(
    `${url}/rest/v1/nhs_documents?storage_bucket=eq.${encodeURIComponent(opts.bucket)}&storage_path=eq.${encodeURIComponent(storagePath)}&select=id`,
    { headers: restHeaders },
  );
  const existing = (await existingRes.json()) as Array<{ id: string }>;
  let registryId: string;
  if (existing.length > 0) {
    registryId = existing[0].id;
    const patch = await fetch(`${url}/rest/v1/nhs_documents?id=eq.${registryId}`, {
      method: "PATCH",
      headers: { ...restHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    });
    if (!patch.ok) throw new Error(`doc patch ${patch.status}: ${(await patch.text()).slice(0, 300)}`);
  } else {
    const ins = await fetch(`${url}/rest/v1/nhs_documents`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!ins.ok) throw new Error(`doc insert ${ins.status}: ${(await ins.text()).slice(0, 300)}`);
    const created = (await ins.json()) as Array<{ id: string }>;
    registryId = created[0]?.id;
  }

  if (opts.docField && DOSSIER_DOC_FIELDS.has(opts.docField)) {
    const patch: Record<string, string> = {};
    patch[opts.docField] = opts.fileName;
    patch[`${opts.docField}_url`] = publicUrl;
    const pd = await fetch(`${url}/rest/v1/nhs_dossiers?id=eq.${opts.dossierId}`, {
      method: "PATCH",
      headers: { ...restHeaders, Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!pd.ok) throw new Error(`dossier patch ${pd.status}: ${(await pd.text()).slice(0, 300)}`);
  }

  return {
    fileId: opts.fileId,
    fileName: opts.fileName,
    docField: opts.docField,
    bytes: opts.buf.length,
    storagePath,
    publicUrl,
    registryId,
    uploaded: true,
  };
}
