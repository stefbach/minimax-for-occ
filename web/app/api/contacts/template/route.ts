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

  // Wrap the xlsx bytes in a Blob — that's the BodyInit shape Next.js's
  // NextResponse type accepts unambiguously across runtimes. Plain Buffer
  // and Uint8Array both trip the stricter TypeScript checks in Next 15.
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "content-disposition":
        'attachment; filename="modele-contacts-axon.xlsx"',
      "cache-control": "no-store",
    },
  });
}
