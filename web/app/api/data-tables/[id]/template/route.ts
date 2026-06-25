import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/data-tables/[id]/template?format=xlsx|csv
//
// Generates an empty workbook/file that matches the table's column spec, with
// the phone column first and a comment row above explaining the format.
// Users fill it in, save, and re-upload via the bulk import.

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data: reg } = await sb
    .from("tenant_data_tables")
    .select("id, physical_table, label, columns, phone_column")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!reg) return NextResponse.json({ error: "table not found" }, { status: 404 });

  const cols = (reg.columns as Array<{ key: string; label: string; type: string }>) ?? [];
  // Phone column comes first (it's mandatory), then the declared columns
  // minus the phone one to avoid duplication.
  const ordered: Array<{ key: string; label: string; type: string }> = [
    { key: reg.phone_column, label: "Phone", type: "phone" },
    ...cols.filter((c) => c.key !== reg.phone_column),
  ];

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") ?? "xlsx").toLowerCase();

  // A one-row preview that shows the type hint for each column. Users see it
  // when they open the file and don't need a separate readme.
  const exampleRow: Record<string, string> = {};
  for (const c of ordered) {
    exampleRow[c.label] =
      c.key === reg.phone_column
        ? "+44XXXXXXXXXX"
        : c.type === "number"
          ? "0"
          : c.type === "boolean"
            ? "oui/non"
            : c.type === "date"
              ? "AAAA-MM-JJ"
              : c.type === "datetime"
                ? "AAAA-MM-JJ HH:MM"
                : c.type === "email"
                  ? "exemple@domaine.com"
                  : "";
  }

  const filenameBase = `modele-${reg.physical_table}`;

  if (format === "csv") {
    const headers = ordered.map((c) => c.label).join(",");
    const example = ordered.map((c) => `"${(exampleRow[c.label] ?? "").replace(/"/g, '""')}"`).join(",");
    const csv = `${headers}\n${example}\n`;
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filenameBase}.csv"`,
      },
    });
  }

  // Default: xlsx — easier for non-tech users to open in Excel directly.
  const ws = XLSX.utils.json_to_sheet([exampleRow], {
    header: ordered.map((c) => c.label),
  });
  // Widen each column a bit so labels are readable.
  ws["!cols"] = ordered.map((c) => ({
    wch: Math.max(c.label.length + 2, c.key === reg.phone_column ? 16 : 14),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filenameBase}.xlsx"`,
    },
  });
}
