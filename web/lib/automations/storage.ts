import type { DataSource } from "./datasource";

/**
 * Supabase Storage + helpers against the patient-pipeline project, mirroring
 * what the n8n flows did with raw HTTP: upload a file to the OCC_Patient
 * bucket, build its public URL, download a stored/public file as bytes, and
 * call the render-pdf edge function that turns Markdown into a branded PDF.
 */

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export function publicUrl(ds: DataSource, bucket: string, path: string): string {
  return `${ds.url}/storage/v1/object/public/${bucket}/${encodePath(path)}`;
}

/** Upload bytes to `bucket/path` (upsert). Returns the public URL. */
export async function uploadObject(
  ds: DataSource,
  bucket: string,
  path: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const url = `${ds.url}/storage/v1/object/${bucket}/${encodePath(path)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ds.serviceKey}`,
      apikey: ds.serviceKey,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: bytes as unknown as BodyInit,
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`storage upload ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return publicUrl(ds, bucket, path);
}

/** Download a file (public or storage path / full URL) as bytes + base64. */
export async function downloadObject(
  ds: DataSource,
  urlOrPath: string,
): Promise<{ bytes: Buffer; base64: string; contentType: string }> {
  const url = urlOrPath.startsWith("http")
    ? urlOrPath
    : `${ds.url}/storage/v1/object/${encodePath(urlOrPath.replace(/^\/+/, ""))}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${ds.serviceKey}`, apikey: ds.serviceKey },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`storage download ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const ab = await r.arrayBuffer();
  const bytes = Buffer.from(ab);
  return {
    bytes,
    base64: bytes.toString("base64"),
    contentType: r.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Render Markdown → branded PDF via the render-pdf edge function. */
export async function renderPdf(
  ds: DataSource,
  markdown: string,
  footer?: string,
): Promise<Buffer> {
  const r = await fetch(`${ds.url}/functions/v1/render-pdf`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ds.serviceKey}`,
      apikey: ds.serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ markdown, ...(footer ? { footer } : {}) }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`render-pdf ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Upsert an nhs_documents row via PostgREST (merge-duplicates on bucket+path). */
export async function upsertNhsDocument(
  ds: DataSource,
  row: Record<string, unknown>,
): Promise<{ id?: string }> {
  const url = `${ds.url}/rest/v1/nhs_documents?on_conflict=storage_bucket,storage_path`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ds.serviceKey}`,
      apikey: ds.serviceKey,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`nhs_documents upsert ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json().catch(() => [])) as Array<{ id?: string }>;
  return Array.isArray(j) && j[0] ? j[0] : {};
}
