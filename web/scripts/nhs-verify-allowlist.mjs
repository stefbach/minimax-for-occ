import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const envFile = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const url = process.env.NHS_LEGACY_SUPABASE_URL;
const key = process.env.NHS_LEGACY_SERVICE_KEY;
if (!url || !key) { console.error('Missing env'); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await supabase.storage.from('patient-documents').list('', { limit: 5 });
if (error) { console.error('ERROR:', error); process.exit(2); }
console.log('OK - bucket reachable. Top-level entries:', data?.length ?? 0);
console.log(JSON.stringify(data?.slice(0, 5).map(d => d.name), null, 2));
