#!/usr/bin/env node
// Usage: node nhs-migrate-upload.mjs <base64_path> <storage_path> <content_type>
// Decodes base64 from disk, uploads to NHS legacy Supabase storage at patient-documents/<storage_path>.
import { readFileSync } from 'node:fs';

const envFile = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const url = process.env.NHS_LEGACY_SUPABASE_URL;
const key = process.env.NHS_LEGACY_SERVICE_KEY;
const [, , b64Path, storagePath, contentType] = process.argv;
if (!url || !key || !b64Path || !storagePath || !contentType) {
  console.error('Missing args or env');
  process.exit(1);
}

const b64 = readFileSync(b64Path, 'utf8').trim();
const buf = Buffer.from(b64, 'base64');

const endpoint = `${url}/storage/v1/object/patient-documents/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
const r = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': contentType,
    'x-upsert': 'true',
  },
  body: buf,
});
const body = await r.text();
console.log(JSON.stringify({ status: r.status, bytes: buf.length, path: storagePath, body: body.slice(0, 500) }));
process.exit(r.ok ? 0 : 2);
