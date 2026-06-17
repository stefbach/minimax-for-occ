// POST /api/nhs-migrate/run — migrate one patient's Drive folder into OCC_Patient
// + nhs_documents + nhs_dossiers.doc_*. Idempotent (storage x-upsert + registry
// upsert keyed on storage_path).
//
//   curl -X POST -H "Authorization: Bearer $NHS_MIGRATION_TOKEN" \
//        -H "Content-Type: application/json" \
//        -d '{"patient":"camila-rossi"}' \
//        https://minimax-for-occ.vercel.app/api/nhs-migrate/run
//
// Returns per-file results { ok|fail, fileId, name, docField, bytes, error }.
// `dryRun: true` lists files + classifications without uploading.

import { NextResponse } from "next/server";
import {
  PATIENTS,
  authOk,
  driveDownload,
  googleAccessToken,
  uploadAndRegister,
  walkPatientFolder,
  type WalkedFile,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel lets functions run up to 300s on Pro+. Mitchell (largest patient, 175MB
// across 33 files) needs the headroom; smaller patients return in seconds.
export const maxDuration = 300;

const BUCKET = "OCC_Patient";

type FileResult =
  | { ok: true; fileId: string; fileName: string; docField: string | null; bytes: number; storagePath: string }
  | { ok: false; fileId: string; fileName: string; docField: string | null; error: string };

export async function POST(req: Request): Promise<NextResponse> {
  if (!authOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { patient?: string; dryRun?: boolean; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const slug = body.patient;
  if (!slug || !PATIENTS[slug]) {
    return NextResponse.json(
      { ok: false, error: "unknown patient slug", valid: Object.keys(PATIENTS) },
      { status: 400 },
    );
  }
  const patient = PATIENTS[slug];

  // Allow caller to supply a pre-minted access token (e.g. from OAuth Playground)
  // so the migration can proceed even when the stored refresh token is broken.
  const token = body.accessToken ? String(body.accessToken) : await googleAccessToken();
  let walked: WalkedFile[];
  try {
    walked = await walkPatientFolder(patient.folderId, token);
  } catch (e) {
    return NextResponse.json(
      { ok: false, stage: "walk", error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      slug,
      patient: { leadId: patient.leadId, dossierId: patient.dossierId, folderId: patient.folderId },
      fileCount: walked.length,
      files: walked.map((w) => ({
        fileId: w.file.id,
        name: w.file.name,
        mimeType: w.file.mimeType,
        size: Number(w.file.size ?? 0),
        docField: w.docField,
        category: w.category,
      })),
    });
  }

  const results: FileResult[] = [];
  let totalBytes = 0;
  for (const w of walked) {
    try {
      const { buf, contentType } = await driveDownload(w.file.id, token);
      const expected = Number(w.file.size ?? 0);
      if (expected > 0 && buf.length !== expected) {
        throw new Error(`downloaded size ${buf.length} != drive ${expected}`);
      }
      const r = await uploadAndRegister({
        buf,
        contentType: w.file.mimeType || contentType,
        bucket: BUCKET,
        leadId: patient.leadId,
        dossierId: patient.dossierId,
        docField: w.docField,
        category: w.category,
        fileName: w.file.name,
        fileId: w.file.id,
      });
      totalBytes += r.bytes;
      results.push({ ok: true, fileId: r.fileId, fileName: r.fileName, docField: r.docField, bytes: r.bytes, storagePath: r.storagePath });
    } catch (e) {
      results.push({
        ok: false,
        fileId: w.file.id,
        fileName: w.file.name,
        docField: w.docField,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  return NextResponse.json({
    ok: failCount === 0,
    slug,
    leadId: patient.leadId,
    dossierId: patient.dossierId,
    counts: { total: results.length, ok: okCount, failed: failCount },
    totalBytes,
    results,
  });
}
