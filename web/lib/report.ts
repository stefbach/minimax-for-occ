"use client";

// Activity report generation — port of the legacy OCC dashboard's "Générer un
// rapport" feature. Aggregates the period's calls into daily or weekly rows
// and renders a PDF (jsPDF + autotable, lazy-loaded) or a semicolon-CSV that
// opens cleanly in French Excel. All processing is client-side over the rows
// already exposed by /api/calls, so no new server surface is needed.

import { bucketForCall, QUAL_BUCKETS } from "@/lib/qualification";

export type ReportFrequency = "daily" | "weekly";
export type ReportFormat = "pdf" | "csv";

// The subset of /api/calls fields the report needs.
export type ReportCall = {
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  cost_cents: number | null;
  metadata: { qualification?: string | null } | null;
};

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

export type ReportData = {
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

const DAYS_FR = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

const isAnswered = (c: ReportCall) => Boolean(c.answered_at);
const isRdv = (c: ReportCall) => {
  const b = bucketForCall(c);
  return b === "rdv_confirme" || b === "passer_humain";
};

// Top (weekday, hour) cell by answer rate, min 3 calls — same heuristic as
// the legacy report's "meilleur créneau".
function bestSlotLabel(calls: ReportCall[]): string {
  const cells = new Map<string, { total: number; answered: number; day: number; hour: number }>();
  for (const c of calls) {
    if (!c.started_at) continue;
    const d = new Date(c.started_at);
    const key = `${d.getDay()}-${d.getHours()}`;
    const cell = cells.get(key) ?? { total: 0, answered: 0, day: d.getDay(), hour: d.getHours() };
    cell.total += 1;
    if (isAnswered(c)) cell.answered += 1;
    cells.set(key, cell);
  }
  const top = [...cells.values()]
    .filter((c) => c.total >= 3)
    .sort((a, b) => b.answered / b.total - a.answered / a.total)[0];
  if (!top) return "—";
  return `${DAYS_FR[top.day]} ${top.hour}h (${((top.answered / top.total) * 100).toFixed(0)}%)`;
}

function bucketDaily(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function bucketWeekly(d: Date): string {
  // ISO week label YYYY-Www.
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((x.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${x.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function buildReportData(args: {
  calls: ReportCall[];
  periodLabel: string;
  frequency: ReportFrequency;
}): ReportData {
  const { calls, periodLabel, frequency } = args;
  const bucketFn = frequency === "daily" ? bucketDaily : bucketWeekly;

  const groups = new Map<string, ReportCall[]>();
  for (const c of calls) {
    if (!c.started_at) continue;
    const key = bucketFn(new Date(c.started_at));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const rowFor = (periodKey: string, group: ReportCall[]): ReportRow => {
    const total = group.length;
    const answered = group.filter(isAnswered).length;
    const rdv = group.filter(isRdv).length;
    const cost = group.reduce((s, c) => s + (c.cost_cents ?? 0), 0) / 100;
    return {
      period: periodKey,
      totalCalls: total,
      answered,
      answerRate: total > 0 ? (answered / total) * 100 : 0,
      rdvConfirmed: rdv,
      conversionRate: answered > 0 ? (rdv / answered) * 100 : 0,
      costDollars: Number(cost.toFixed(2)),
      bestSlot: bestSlotLabel(group),
    };
  };

  const rows = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, g]) => rowFor(k, g));

  const total = calls.length;
  const answered = calls.filter(isAnswered).length;
  const rdv = calls.filter(isRdv).length;
  const cost = calls.reduce((s, c) => s + (c.cost_cents ?? 0), 0) / 100;

  const counts: Record<string, number> = {};
  for (const c of calls) {
    const key = bucketForCall(c);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const qualification = QUAL_BUCKETS
    .map((b) => ({
      label: b.label,
      count: counts[b.key] ?? 0,
      percent: total > 0 ? ((counts[b.key] ?? 0) / total) * 100 : 0,
    }))
    .filter((q) => q.count > 0);

  return {
    periodLabel,
    rows,
    totals: {
      totalCalls: total,
      answered,
      answerRate: total > 0 ? (answered / total) * 100 : 0,
      rdvConfirmed: rdv,
      conversionRate: answered > 0 ? (rdv / answered) * 100 : 0,
      costDollars: Number(cost.toFixed(2)),
    },
    qualification,
    bestSlotOverall: bestSlotLabel(calls),
  };
}

// ─── PDF ────────────────────────────────────────────────────────────────────
// jsPDF (~350 kB) is only pulled when the operator actually generates a PDF.

const BRAND: [number, number, number] = [91, 107, 191];

export async function generatePdf(data: ReportData, frequency: ReportFrequency): Promise<Blob> {
  const { default: JsPdf } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new JsPdf({ unit: "pt", format: "a4" });
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  doc.setFontSize(18);
  doc.setTextColor(...BRAND);
  doc.text("Rapport d'activité — Appels", 40, 50);

  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(`Période : ${data.periodLabel}`, 40, 70);
  doc.text(`Fréquence : ${frequency === "daily" ? "Journalière" : "Hebdomadaire"}`, 40, 85);
  doc.text(`Généré le ${new Date().toLocaleString("fr-FR")}`, 40, 100);

  autoTable(doc, {
    startY: 120,
    head: [["Indicateur", "Valeur"]],
    body: [
      ["Total appels", data.totals.totalCalls.toLocaleString("fr-FR")],
      ["Appels décrochés", `${data.totals.answered.toLocaleString("fr-FR")} (${data.totals.answerRate.toFixed(1)}%)`],
      ["RDV confirmés", data.totals.rdvConfirmed.toLocaleString("fr-FR")],
      ["Taux de conversion (RDV / décrochés)", `${data.totals.conversionRate.toFixed(1)}%`],
      ["Coût total", `$${data.totals.costDollars.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
      ["Meilleur créneau (période)", data.bestSlotOverall],
    ],
    theme: "striped",
    headStyles: { fillColor: BRAND },
    styles: { fontSize: 10 },
  });

  if (data.qualification.length > 0) {
    const y = lastY();
    doc.setFontSize(12);
    doc.setTextColor(...BRAND);
    doc.text("Répartition par qualification", 40, y + 24);
    autoTable(doc, {
      startY: y + 32,
      head: [["Qualification", "Appels", "%"]],
      body: data.qualification.map((q) => [q.label, q.count.toLocaleString("fr-FR"), `${q.percent.toFixed(1)}%`]),
      theme: "striped",
      headStyles: { fillColor: BRAND },
      styles: { fontSize: 10 },
    });
  }

  if (data.rows.length > 0) {
    const y = lastY();
    doc.setFontSize(12);
    doc.setTextColor(...BRAND);
    doc.text(`Détail ${frequency === "daily" ? "journalier" : "hebdomadaire"}`, 40, y + 24);
    autoTable(doc, {
      startY: y + 32,
      head: [[
        frequency === "daily" ? "Jour" : "Semaine",
        "Appels", "Décrochés", "Tx déc.", "RDV", "Conv.", "Coût $", "Meilleur créneau",
      ]],
      body: data.rows.map((r) => [
        r.period,
        r.totalCalls.toLocaleString("fr-FR"),
        r.answered.toLocaleString("fr-FR"),
        `${r.answerRate.toFixed(0)}%`,
        r.rdvConfirmed.toLocaleString("fr-FR"),
        `${r.conversionRate.toFixed(0)}%`,
        `$${r.costDollars.toFixed(2)}`,
        r.bestSlot,
      ]),
      theme: "striped",
      headStyles: { fillColor: BRAND },
      styles: { fontSize: 9 },
    });
  }

  return doc.output("blob");
}

// ─── CSV ────────────────────────────────────────────────────────────────────

function escapeCsv(v: string | number): string {
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function generateCsv(data: ReportData, frequency: ReportFrequency): Blob {
  const lines: string[] = [];
  lines.push("Rapport d'activité — Appels");
  lines.push(`Période;${escapeCsv(data.periodLabel)}`);
  lines.push(`Fréquence;${frequency === "daily" ? "Journalière" : "Hebdomadaire"}`);
  lines.push(`Généré le;${new Date().toLocaleString("fr-FR")}`);
  lines.push("");
  lines.push("Indicateur;Valeur");
  lines.push(`Total appels;${data.totals.totalCalls}`);
  lines.push(`Appels décrochés;${data.totals.answered}`);
  lines.push(`Taux de décroché;${data.totals.answerRate.toFixed(1)}%`);
  lines.push(`RDV confirmés;${data.totals.rdvConfirmed}`);
  lines.push(`Taux de conversion;${data.totals.conversionRate.toFixed(1)}%`);
  lines.push(`Coût total ($);${data.totals.costDollars.toFixed(2)}`);
  lines.push(`Meilleur créneau;${escapeCsv(data.bestSlotOverall)}`);
  lines.push("");
  lines.push("Qualification;Appels;Pourcentage");
  for (const q of data.qualification) {
    lines.push(`${escapeCsv(q.label)};${q.count};${q.percent.toFixed(1)}%`);
  }
  lines.push("");
  lines.push([
    frequency === "daily" ? "Jour" : "Semaine",
    "Appels", "Décrochés", "Tx décroché", "RDV", "Conversion", "Coût $", "Meilleur créneau",
  ].join(";"));
  for (const r of data.rows) {
    lines.push([
      r.period, r.totalCalls, r.answered,
      `${r.answerRate.toFixed(1)}%`, r.rdvConfirmed, `${r.conversionRate.toFixed(1)}%`,
      `$${r.costDollars.toFixed(2)}`, escapeCsv(r.bestSlot),
    ].join(";"));
  }
  // BOM so Excel opens UTF-8 accents correctly.
  return new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
}

// ─── Download helpers ───────────────────────────────────────────────────────

export function reportFilename(args: { periodLabel: string; frequency: ReportFrequency; format: ReportFormat }): string {
  const safePeriod = args.periodLabel
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `Rapport_${safePeriod}_${stamp}.${args.format}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
