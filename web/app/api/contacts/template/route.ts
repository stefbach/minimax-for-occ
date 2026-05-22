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

  // Build the sheet cell-by-cell so we can pin the `phone` column to a
  // String type + Text number format ("@"). Otherwise Excel sees a value
  // starting with "+" and treats it as a formula prefix — strips the "+"
  // and stores the cell as a number on user edit. The import endpoint
  // already re-prefixes bare digits with "+", but it's friendlier if the
  // template itself keeps the "+" visible end-to-end.
  const allRows = [headers, ...examples];
  const ws: XLSX.WorkSheet = {};
  for (let r = 0; r < allRows.length; r++) {
    for (let c = 0; c < allRows[r].length; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      const value = allRows[r][c];
      // Phone data rows = column 0, rows 1+. Force string + text format.
      const isPhoneData = c === 0 && r > 0;
      ws[cellAddr] = isPhoneData
        ? { t: "s", v: value, z: "@" }
        : { t: "s", v: value };
    }
  }
  ws["!ref"] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: headers.length - 1, r: allRows.length - 1 },
  });

  // Set column widths so the file looks readable when opened. The
  // per-cell `z: "@"` set above is what actually pins the text format;
  // ColInfo doesn't accept a column-level `z` in xlsx's TypeScript types.
  ws["!cols"] = [
    { wch: 18 }, // phone
    { wch: 22 }, // name
    { wch: 26 }, // email
    { wch: 18 }, // tags
    { wch: 40 }, // notes
  ];

  const wb = XLSX.utils.book_new();
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
