import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Types (mirrors web/lib/report.ts — kept here to avoid "use client" import) ──

type ReportFrequency = "daily" | "weekly";

type ReportRow = {
  period: string;
  totalCalls: number;
  answered: number;
  answerRate: number;
  rdvConfirmed: number;
  conversionRate: number;
  costDollars: number;
  bestSlot: string;
};

type ReportData = {
  periodLabel: string;
  rows: ReportRow[];
  totals: {
    totalCalls: number;
    answered: number;
    answerRate: number;
    rdvConfirmed: number;
    conversionRate: number;
    costDollars: number;
  };
  qualification: { label: string; count: number; percent: number }[];
  bestSlotOverall: string;
};

type PatientRow = {
  nom: string | null;
  email: string | null;
  numero_telephone: string | null;
  patient_dob: string | null;
  poids: number | null;
  taille: number | null;
  bmi: number | null;
  other_chronic_conditions: string | null;
  current_phase: string | null;
  call_count: number | null;
  qualification: string | null;
  last_call_datetime: string | null;
};

type PatientSections = {
  rdvConfirme: PatientRow[];
  passerHumain: PatientRow[];
};

// ── Color palette ────────────────────────────────────────────────────────────

const C = {
  navy:      "FF1F3864",
  navyDark:  "FF162746",
  blue:      "FF2E75B6",
  teal:      "FF1ABC9C",
  orange:    "FFE67E22",
  red:       "FFE74C3C",
  green:     "FF27AE60",
  white:     "FFFFFFFF",
  pinkRow:   "FFFFF0F0",
  greenRow:  "FFF0FFF4",
  blueRow:   "FFF0F4FF",
  grayRow:   "FFF8F8F8",
  black:     "FF000000",
  headerCol: "FF1A3A5C",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sf(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

type StyleOpts = {
  value?: ExcelJS.CellValue;
  bg?: string;
  fg?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  halign?: ExcelJS.Alignment["horizontal"];
  valign?: ExcelJS.Alignment["vertical"];
  wrap?: boolean;
  border?: boolean;
};

function sc(cell: ExcelJS.Cell, o: StyleOpts) {
  if (o.value !== undefined) cell.value = o.value;
  if (o.bg) cell.fill = sf(o.bg);
  cell.font = {
    name: "Calibri",
    color: { argb: o.fg ?? C.black },
    size: o.size ?? 10,
    bold: o.bold ?? false,
    italic: o.italic ?? false,
  };
  cell.alignment = {
    horizontal: o.halign ?? "left",
    vertical: o.valign ?? "middle",
    wrapText: o.wrap ?? false,
  };
  if (o.border) {
    const bs: ExcelJS.Border = { style: "thin", color: { argb: "FFD0D0D0" } };
    cell.border = { top: bs, left: bs, bottom: bs, right: bs };
  }
}

function calcAge(dob: string | null): string {
  if (!dob) return "";
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return String(age);
}

// Merge helper — wraps ws.mergeCells in a try/catch so overlapping merges don't crash
function merge(ws: ExcelJS.Worksheet, range: string) {
  try { ws.mergeCells(range); } catch { /* already merged */ }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  let body: { data: ReportData; frequency: ReportFrequency; patients?: PatientSections };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data, frequency, patients } = body;
  const freqLabel = frequency === "daily" ? "Journalière" : "Hebdomadaire";
  const periodCol = frequency === "daily" ? "Jour" : "Semaine";

  const wb = new ExcelJS.Workbook();
  wb.creator = "OCC Dashboard";
  const ws = wb.addWorksheet("Rapport", { views: [{ state: "frozen", ySplit: 5 }] });

  // 12 equal-ish columns (each KPI tile = 3 cols)
  ws.columns = [
    { width: 18 }, // A
    { width: 14 }, // B
    { width: 14 }, // C
    { width: 18 }, // D
    { width: 14 }, // E
    { width: 14 }, // F
    { width: 18 }, // G
    { width: 14 }, // H
    { width: 14 }, // I
    { width: 18 }, // J
    { width: 14 }, // K
    { width: 16 }, // L
  ];

  let r = 1; // current row

  // ─── TITLE ───────────────────────────────────────────────────────────────
  ws.getRow(r).height = 40;
  sc(ws.getCell(`A${r}`), {
    value: "Rapport d'activité — Appels",
    bg: C.navy, fg: C.white, size: 20, bold: true,
    halign: "center", valign: "middle",
  });
  merge(ws, `A${r}:L${r}`);
  r++;

  // ─── META (Period / Frequency / Generated) ───────────────────────────────
  const meta = [
    ["Période", data.periodLabel],
    ["Fréquence", freqLabel],
    ["Généré le", new Date().toLocaleString("fr-FR")],
  ];
  for (const [label, value] of meta) {
    ws.getRow(r).height = 20;
    sc(ws.getCell(`A${r}`), { value: label, bg: C.blue, fg: C.white, bold: true, halign: "left" });
    merge(ws, `A${r}:C${r}`);
    sc(ws.getCell(`D${r}`), { value: value as string, bg: C.blue, fg: C.white, halign: "left" });
    merge(ws, `D${r}:L${r}`);
    r++;
  }

  // Spacer
  ws.getRow(r).height = 6;
  for (let c = 1; c <= 12; c++) ws.getCell(r, c).fill = sf(C.navy);
  r++;

  // ─── KPI TILES (2 rows × 4 tiles, each tile = 3 columns) ─────────────────
  const kpis = [
    { label: "Total appels",      value: String(data.totals.totalCalls),                   color: C.navy   },
    { label: "Appels décrochés",  value: String(data.totals.answered),                     color: C.blue   },
    { label: "Taux de décroché",  value: `${data.totals.answerRate.toFixed(1)} %`,          color: C.teal   },
    { label: "RDV confirmés",     value: String(data.totals.rdvConfirmed),                  color: C.orange },
    { label: "Taux de conversion",value: `${data.totals.conversionRate.toFixed(1)} %`,      color: C.navy   },
    { label: "Coût total",        value: `$${data.totals.costDollars.toFixed(2)}`,          color: C.blue   },
    { label: "Meilleur créneau",  value: data.bestSlotOverall || "—",                       color: C.teal   },
    { label: "",                  value: "",                                                  color: C.orange },
  ];

  // Tile column ranges
  const tileRanges = [
    { s: "A", e: "C" },
    { s: "D", e: "F" },
    { s: "G", e: "I" },
    { s: "J", e: "L" },
  ];

  for (let tileRow = 0; tileRow < 2; tileRow++) {
    const labelRowNum = r;
    const valueRowNum = r + 1;
    ws.getRow(labelRowNum).height = 16;
    ws.getRow(valueRowNum).height = 44;

    for (let tileCol = 0; tileCol < 4; tileCol++) {
      const kpi = kpis[tileRow * 4 + tileCol];
      const { s, e } = tileRanges[tileCol];

      // Label
      sc(ws.getCell(`${s}${labelRowNum}`), {
        value: kpi.label,
        bg: kpi.color, fg: C.white, size: 9, bold: true,
        halign: "center", valign: "middle",
      });
      merge(ws, `${s}${labelRowNum}:${e}${labelRowNum}`);

      // Value
      sc(ws.getCell(`${s}${valueRowNum}`), {
        value: kpi.value,
        bg: kpi.color, fg: C.white, size: 24, bold: true,
        halign: "center", valign: "middle",
      });
      merge(ws, `${s}${valueRowNum}:${e}${valueRowNum}`);
    }
    r += 2;
  }

  // Spacer
  ws.getRow(r).height = 10;
  r++;

  // ─── QUALIFICATION BREAKDOWN ─────────────────────────────────────────────
  if (data.qualification.length > 0) {
    // Section header
    ws.getRow(r).height = 24;
    sc(ws.getCell(`A${r}`), {
      value: "RÉPARTITION PAR QUALIFICATION",
      bg: C.navy, fg: C.white, size: 12, bold: true,
      halign: "left", valign: "middle",
    });
    merge(ws, `A${r}:L${r}`);
    r++;

    // Column headers
    ws.getRow(r).height = 20;
    sc(ws.getCell(`A${r}`), { value: "Qualification",  bg: C.headerCol, fg: C.white, bold: true, halign: "left", valign: "middle" });
    merge(ws, `A${r}:H${r}`);
    sc(ws.getCell(`I${r}`), { value: "Appels",         bg: C.headerCol, fg: C.white, bold: true, halign: "center", valign: "middle" });
    merge(ws, `I${r}:J${r}`);
    sc(ws.getCell(`K${r}`), { value: "Pourcentage",    bg: C.headerCol, fg: C.white, bold: true, halign: "center", valign: "middle" });
    merge(ws, `K${r}:L${r}`);
    r++;

    // Data rows
    for (let i = 0; i < data.qualification.length; i++) {
      const q = data.qualification[i];
      const bg = i % 2 === 1 ? C.grayRow : undefined;
      ws.getRow(r).height = 18;

      sc(ws.getCell(`A${r}`), { value: q.label,  bg, halign: "left",   valign: "middle", size: 10 });
      merge(ws, `A${r}:H${r}`);
      sc(ws.getCell(`I${r}`), { value: q.count,  bg, halign: "center", valign: "middle", size: 10 });
      merge(ws, `I${r}:J${r}`);
      sc(ws.getCell(`K${r}`), { value: `${q.percent.toFixed(1)} %`, bg, halign: "center", valign: "middle", size: 10 });
      merge(ws, `K${r}:L${r}`);
      r++;
    }

    ws.getRow(r).height = 10;
    r++;
  }

  // ─── PERIOD BREAKDOWN ───────────────────────────────────────────────────
  if (data.rows.length > 0) {
    // Section header
    ws.getRow(r).height = 24;
    sc(ws.getCell(`A${r}`), {
      value: `DÉTAIL ${frequency === "daily" ? "JOURNALIER" : "HEBDOMADAIRE"}`,
      bg: C.navy, fg: C.white, size: 12, bold: true,
      halign: "left", valign: "middle",
    });
    merge(ws, `A${r}:L${r}`);
    r++;

    // Column headers
    ws.getRow(r).height = 20;
    const bHeaders: { label: string; s: string; e: string }[] = [
      { label: periodCol,        s: "A", e: "B" },
      { label: "Appels",        s: "C", e: "C" },
      { label: "Décrochés",     s: "D", e: "D" },
      { label: "Taux décroché", s: "E", e: "F" },
      { label: "RDV",           s: "G", e: "G" },
      { label: "Conversion",    s: "H", e: "I" },
      { label: "Coût ($)",      s: "J", e: "K" },
      { label: "Meilleur créneau", s: "L", e: "L" },
    ];
    for (const h of bHeaders) {
      sc(ws.getCell(`${h.s}${r}`), {
        value: h.label, bg: C.blue, fg: C.white, bold: true, size: 9,
        halign: "center", valign: "middle", wrap: true,
      });
      if (h.s !== h.e) merge(ws, `${h.s}${r}:${h.e}${r}`);
    }
    r++;

    // Data rows
    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i];
      const bg = i % 2 === 1 ? C.blueRow : undefined;
      ws.getRow(r).height = 18;

      const cells: { s: string; e?: string; val: ExcelJS.CellValue; align?: ExcelJS.Alignment["horizontal"] }[] = [
        { s: "A", e: "B", val: row.period },
        { s: "C",         val: row.totalCalls,                     align: "center" },
        { s: "D",         val: row.answered,                       align: "center" },
        { s: "E", e: "F", val: `${row.answerRate.toFixed(1)} %`,   align: "center" },
        { s: "G",         val: row.rdvConfirmed,                   align: "center" },
        { s: "H", e: "I", val: `${row.conversionRate.toFixed(1)} %`, align: "center" },
        { s: "J", e: "K", val: `$${row.costDollars.toFixed(2)}`,   align: "center" },
        { s: "L",         val: row.bestSlot || "—",                align: "center" },
      ];
      for (const c of cells) {
        sc(ws.getCell(`${c.s}${r}`), {
          value: c.val, bg, halign: c.align ?? "left", valign: "middle", size: 10,
        });
        if (c.e && c.s !== c.e) merge(ws, `${c.s}${r}:${c.e}${r}`);
      }
      r++;
    }

    ws.getRow(r).height = 10;
    r++;
  }

  // ─── PATIENT SECTIONS ────────────────────────────────────────────────────
  const PATIENT_COLS = [
    "Nom complet", "Email", "Téléphone", "Âge",
    "Poids (kg)", "Taille (cm)", "IMC", "Comorbidités",
    "Palier", "Total appels", "Qualification", "Dernier appel",
  ];

  function addPatients(title: string, pts: PatientRow[], headerBg: string, rowBg: string) {
    if (!pts.length) return;

    ws.getRow(r).height = 26;
    sc(ws.getCell(`A${r}`), {
      value: title, bg: headerBg, fg: C.white, size: 12, bold: true,
      halign: "left", valign: "middle",
    });
    merge(ws, `A${r}:L${r}`);
    r++;

    ws.getRow(r).height = 22;
    for (let ci = 0; ci < PATIENT_COLS.length; ci++) {
      sc(ws.getCell(r, ci + 1), {
        value: PATIENT_COLS[ci], bg: C.headerCol, fg: C.white, bold: true, size: 9,
        halign: "center", valign: "middle", wrap: true,
      });
    }
    r++;

    for (const p of pts) {
      ws.getRow(r).height = 18;
      const vals: ExcelJS.CellValue[] = [
        p.nom ?? "",
        p.email ?? "",
        p.numero_telephone ?? "",
        calcAge(p.patient_dob),
        p.poids ?? "",
        p.taille ?? "",
        p.bmi ?? "",
        p.other_chronic_conditions ?? "",
        p.current_phase ?? "",
        p.call_count ?? 0,
        p.qualification ?? "",
        p.last_call_datetime
          ? new Date(p.last_call_datetime).toLocaleDateString("fr-FR")
          : "",
      ];
      for (let ci = 0; ci < vals.length; ci++) {
        sc(ws.getCell(r, ci + 1), {
          value: vals[ci], bg: rowBg, halign: "left", valign: "middle", size: 9,
        });
      }
      r++;
    }

    ws.getRow(r).height = 10;
    r++;
  }

  if (patients) {
    addPatients(
      `RDV CONFIRMÉ — ${patients.rdvConfirme.length} patient(s)`,
      patients.rdvConfirme,
      C.green,
      C.greenRow,
    );
    addPatients(
      `À PASSER À L'HUMAIN — ${patients.passerHumain.length} patient(s)`,
      patients.passerHumain,
      C.red,
      C.pinkRow,
    );
  }

  // ─── FOOTER ──────────────────────────────────────────────────────────────
  ws.getRow(r).height = 22;
  sc(ws.getCell(`A${r}`), {
    value: `OCC Dashboard · Généré le ${new Date().toLocaleString("fr-FR")}`,
    bg: C.navyDark, fg: C.white, size: 9,
    halign: "center", valign: "middle",
  });
  merge(ws, `A${r}:L${r}`);

  // ─── Output ──────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rapport.xlsx"`,
    },
  });
}
