import { NextResponse } from "next/server";
import { currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { loadPatientDataForExport } from "@/lib/reports/data";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["super_admin", "owner", "admin", "manager"]);

export async function GET(req: Request) {
  const orgId = await currentOrgIdForServer();
  if (!orgId) return NextResponse.json({ error: "no org" }, { status: 401 });
  const role = await currentRoleInOrg(orgId);
  if (!role || !ALLOWED_ROLES.has(role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = url.searchParams.get("to") ?? new Date().toISOString();
  const lang = (url.searchParams.get("lang") ?? "fr") as "fr" | "en";

  const rows = await loadPatientDataForExport(orgId, { fromIso: from, toIso: to });

  const isFr = lang === "fr";
  const headers = isFr
    ? ["Nom complet", "Email", "Téléphone", "Âge", "Poids (kg)", "Taille (cm)", "IMC", "Comorbidités", "Palier programme", "Total appels", "Qualification", "Dernier appel"]
    : ["Full name", "Email", "Phone", "Age", "Weight (kg)", "Height (cm)", "BMI", "Comorbidities", "Program tier", "Total calls", "Qualification", "Last call"];

  function calcAge(dob: string | null): number | "" {
    if (!dob) return "";
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return "";
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  const sheetRows = rows.map((r) => [
    r.nom ?? "",
    r.email ?? "",
    r.numero_telephone ?? "",
    calcAge(r.patient_dob),
    r.poids ?? "",
    r.taille ?? "",
    r.bmi ?? "",
    r.other_chronic_conditions ?? "",
    "",
    r.call_count ?? 0,
    r.qualification ?? "",
    r.last_call_datetime
      ? new Date(r.last_call_datetime).toLocaleDateString(isFr ? "fr-FR" : "en-GB")
      : "",
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sheetRows]);

  // Column widths
  ws["!cols"] = [
    { wch: 28 }, { wch: 30 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 22 }, { wch: 18 },
  ];

  const sheetName = isFr ? "Patients" : "Patients";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const raw = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  const buf = Buffer.from(raw);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `patients-export-${dateStr}.xlsx`;

  // Copy into a standalone ArrayBuffer so the response body is a well-typed
  // BodyInit across Next runtimes — the bare Uint8Array<ArrayBufferLike>
  // returned by XLSX.write is rejected by the NextResponse/Blob types.
  const body = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
