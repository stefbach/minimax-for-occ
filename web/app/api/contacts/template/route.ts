import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/contacts/template
 *
 * Returns an .xlsx file with the exact columns the bulk-import endpoint
 * expects + a couple of example rows so the client knows the format
 * (Excel rather than CSV because most non-technical clients don't know
 * what CSV is).
 *
 * Columns:
 *   phone (E.164, REQUIRED)  e.g. +33612345678
 *   name                     e.g. Marie Dupont
 *   email                    e.g. marie@example.com
 *   tags                     comma-separated, e.g. "vip, fr"
 *   notes                    free text
 */
export async function GET() {
  const headers = ["phone", "name", "email", "tags", "notes"];
  const examples = [
    ["+33612345678", "Marie Dupont", "marie@example.com", "vip, fr", "Cliente fidèle depuis 2024"],
    ["+44771234567", "John Smith", "john@example.com", "uk", ""],
    ["+23059452424", "Jean-Marc Lavoine", "", "mu", "Numéro mauricien"],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);

  // Set column widths so the file looks readable when opened.
  ws["!cols"] = [
    { wch: 18 }, // phone
    { wch: 22 }, // name
    { wch: 26 }, // email
    { wch: 18 }, // tags
    { wch: 40 }, // notes
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Contacts");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":
        'attachment; filename="modele-contacts-axon.xlsx"',
      "cache-control": "no-store",
    },
  });
}
