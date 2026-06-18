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
    ? ["Nom complet", "Email", "Téléphone", "Poids (kg)", "Taille (cm)", "IMC", "Qualification", "Dernier appel"]
    : ["Full name", "Email", "Phone", "Weight (kg)", "Height (cm)", "BMI", "Qualification", "Last call"];

  const sheetRows = rows.map((r) => [
    r.nom ?? "",
    r.email ?? "",
    r.numero_telephone ?? "",
    r.poids ?? "",
    r.taille ?? "",
    r.bmi ?? "",
    r.qualification ?? "",
    r.last_call_datetime
      ? new Date(r.last_call_datetime).toLocaleDateString(isFr ? "fr-FR" : "en-GB")
      : "",
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sheetRows]);

  // Column widths
  ws["!cols"] = [
    { wch: 28 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 18 },
  ];

  const sheetName = isFr ? "Patients" : "Patients";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `patients-export-${dateStr}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
