#!/usr/bin/env node
// Usage: node nhs-verify-patient.mjs <patient_slug>
// Lists every object under b59112e0-.../<slug>/ and prints doc_key/filename/size.
import { readFileSync } from 'node:fs';

const envFile = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const url = process.env.NHS_LEGACY_SUPABASE_URL;
const key = process.env.NHS_LEGACY_SERVICE_KEY;
const slug = process.argv[2];
if (!url || !key || !slug) { console.error('Missing args/env'); process.exit(1); }

const root = `b59112e0-7172-4b05-8dcb-9b34d3f97806/${slug}`;

async function list(prefix) {
  const r = await fetch(`${url}/storage/v1/object/list/patient-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: prefix + '/', limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  });
  return r.json();
}

const docKeys = await list(root);
let total = 0, bytes = 0;
const out = [];
for (const dk of docKeys) {
  if (dk.id !== null) continue; // skip stray files at slug root
  const files = await list(`${root}/${dk.name}`);
  for (const f of files) {
    if (f.id === null) continue;
    total++;
    const sz = f.metadata?.size ?? 0;
    bytes += sz;
    out.push(`${dk.name}/${f.name}  ${sz}`);
  }
}
console.log(out.join('\n'));
console.log(`\nTOTAL: ${total} files, ${bytes} bytes`);
