// GET /api/nhs-migrate/health — verifies all secrets are configured AND the
// downstream services we depend on respond. Bearer-token protected so we don't
// publicly leak which env vars are set.
//
//   curl -H "Authorization: Bearer $NHS_MIGRATION_TOKEN" \
//        https://minimax-for-occ.vercel.app/api/nhs-migrate/health
//
// Returns 200 only if env+Google OAuth+Drive list+Supabase storage list all succeed.

import { NextResponse } from "next/server";
import { authOk, envState, googleAccessToken, driveList, NHS_FOLDER_ROOT } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  if (!authOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const env = envState();
  const envOk = Object.values(env).every(Boolean);
  if (!envOk) {
    return NextResponse.json({ ok: false, stage: "env", env }, { status: 500 });
  }

  let googleOk = false;
  let driveOk = false;
  let driveSampleCount = 0;
  let googleErr: string | null = null;
  try {
    const token = await googleAccessToken();
    googleOk = !!token;
    const files = await driveList(NHS_FOLDER_ROOT, token);
    driveOk = files.length > 0;
    driveSampleCount = files.length;
  } catch (e) {
    googleErr = e instanceof Error ? e.message : String(e);
  }

  let supabaseOk = false;
  let supabaseErr: string | null = null;
  try {
    const url = process.env.NHS_LEGACY_SUPABASE_URL!;
    const key = process.env.NHS_LEGACY_SERVICE_KEY!;
    const r = await fetch(`${url}/storage/v1/object/list/OCC_Patient`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 1 }),
    });
    supabaseOk = r.ok;
    if (!r.ok) supabaseErr = `${r.status}: ${(await r.text()).slice(0, 200)}`;
  } catch (e) {
    supabaseErr = e instanceof Error ? e.message : String(e);
  }

  const ok = envOk && googleOk && driveOk && supabaseOk;
  return NextResponse.json(
    {
      ok,
      env,
      google: { ok: googleOk, error: googleErr },
      drive: { ok: driveOk, rootFolder: NHS_FOLDER_ROOT, childrenSeen: driveSampleCount },
      supabase: { ok: supabaseOk, bucket: "OCC_Patient", error: supabaseErr },
    },
    { status: ok ? 200 : 500 },
  );
}
