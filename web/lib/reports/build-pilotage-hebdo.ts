/**
 * Builder for the "Pilotage hebdomadaire" template. Assembles the data layer
 * + the AI narrative into a complete ReportPayload the viewer can render.
 *
 * Other templates (bilan_mensuel, perf_par_agent, funnel_campagne, nhs_s2)
 * follow the same pattern — they swap which periods to use, which leads to
 * surface and which extra annexes to ship.
 */

import {
  loadCallAggregates,
  loadLeadsDueForCallback,
  loadOverDialedLeads,
  type CallAggregates,
} from "./data";
import { generateNarrative } from "./ai-narrative";
import type {
  ActionTier,
  AnnexSection,
  FunnelStage,
  Kpi,
  ReportPayload,
  ReportPeriod,
} from "./types";

// ── Bilingual label table ────────────────────────────────────────────────────

const T = {
  fr: {
    reportTitle: "Rapport hebdomadaire de prospection",
    reportSubtitle: "Pilotage des appels Axon — du suivi descriptif à l'action",
    kpiLabels: ["Total appels passés", "Taux de décroché", "Qualif productive", "RDV + Humain"],
    kpiHints: [
      (a: CallAggregates) => `${a.answered} décrochés · ${a.unanswered} non répondus`,
      (a: CallAggregates) => `${a.answered} sur ${a.total}`,
      (a: CallAggregates) => `${a.rappel + a.rdvConfirme + a.passerHumain} pistes actives (RAPPEL+RDV+humain)`,
      (a: CallAggregates) => `${a.rdvConfirme} RDV · ${a.passerHumain} à passer humain`,
    ],
    funnelLabels: ["Appels passés", "Décrochés", "Qualif productive", "RDV + Humain"],
    callbackTierTitle: "Rappels échus à traiter — fenêtre immédiate",
    callbackReason: (count: number) => `RAPPEL programmé · ${count} tentatives jusqu'ici`,
    overDialedTierTitle: "Sur-appelés sans qualif — arbitrer ou clôturer",
    overDialedReason: (count: number, qualif: string) => `${count} tentatives · qualif ${qualif}`,
    annexHeading: "Volume d'appels par heure (UTC)",
    annexSub: "Top des heures les plus actives sur la période, en UTC.",
    annexCols: [
      { key: "h_utc", label: "Heure UTC" },
      { key: "h_uk", label: "Heure UK" },
      { key: "h_mu", label: "Heure Maurice" },
      { key: "count", label: "Appels" },
    ],
    metaVolume: (total: number) => `${total.toLocaleString("fr-FR")} appels`,
    metaAnswered: "Décrochés",
    metaPipeline: (n: number) => `${n} à rappeler`,
    metaStatus: "Confidentiel — usage interne",
    narrativeTitle: "Pilotage hebdomadaire de la prospection",
  },
  en: {
    reportTitle: "Weekly Prospecting Report",
    reportSubtitle: "Axon call management — from descriptive tracking to action",
    kpiLabels: ["Total calls made", "Answer rate", "Productive qualification", "Appts + Human"],
    kpiHints: [
      (a: CallAggregates) => `${a.answered} answered · ${a.unanswered} unanswered`,
      (a: CallAggregates) => `${a.answered} out of ${a.total}`,
      (a: CallAggregates) => `${a.rappel + a.rdvConfirme + a.passerHumain} active leads (CB+Appt+Human)`,
      (a: CallAggregates) => `${a.rdvConfirme} appts · ${a.passerHumain} to human`,
    ],
    funnelLabels: ["Calls made", "Answered", "Productive qualif", "Appts + Human"],
    callbackTierTitle: "Overdue callbacks — immediate window",
    callbackReason: (count: number) => `Scheduled callback · ${count} attempts so far`,
    overDialedTierTitle: "Over-dialled without qualification — arbitrate or close",
    overDialedReason: (count: number, qualif: string) => `${count} attempts · qualif: ${qualif}`,
    annexHeading: "Call volume by hour (UTC)",
    annexSub: "Top most active hours over the period, in UTC.",
    annexCols: [
      { key: "h_utc", label: "UTC Time" },
      { key: "h_uk", label: "UK Time" },
      { key: "h_mu", label: "Mauritius Time" },
      { key: "count", label: "Calls" },
    ],
    metaVolume: (total: number) => `${total.toLocaleString("en-GB")} calls`,
    metaAnswered: "Answered",
    metaPipeline: (n: number) => `${n} to callback`,
    metaStatus: "Confidential — internal use",
    narrativeTitle: "Weekly prospecting management",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtFR(d: Date): string {
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function fmtPhone(p: string | null | undefined): string {
  if (!p) return "—";
  return p.replace(/^(\+\d{1,3})(\d+)$/, "$1 $2");
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 0) return "à venir";
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  return `${days} j`;
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildKpis(a: CallAggregates, t: typeof T["fr"]): Kpi[] {
  const pctDecroche = a.total > 0 ? Math.round((100 * a.answered) / a.total) : 0;
  const pctProductif =
    a.answered > 0
      ? Math.round((100 * (a.rappel + a.rdvConfirme + a.passerHumain)) / a.answered)
      : 0;
  return [
    {
      label: t.kpiLabels[0],
      value: a.total.toLocaleString("fr-FR"),
      hint: t.kpiHints[0](a),
      tone: "neutral",
    },
    {
      label: t.kpiLabels[1],
      value: `${pctDecroche} %`,
      hint: t.kpiHints[1](a),
      tone: pctDecroche >= 25 ? "good" : pctDecroche >= 15 ? "warn" : "bad",
    },
    {
      label: t.kpiLabels[2],
      value: `${pctProductif} %`,
      hint: t.kpiHints[2](a),
      tone: pctProductif >= 40 ? "good" : pctProductif >= 25 ? "warn" : "bad",
    },
    {
      label: t.kpiLabels[3],
      value: `${a.rdvConfirme + a.passerHumain}`,
      hint: t.kpiHints[3](a),
      tone: "good",
    },
  ];
}

function buildFunnel(a: CallAggregates, t: typeof T["fr"]): FunnelStage[] {
  const productifTotal = a.rappel + a.rdvConfirme + a.passerHumain;
  const pctAnswered = a.total > 0 ? Math.round((100 * a.answered) / a.total) : 0;
  const pctProductif =
    a.answered > 0 ? Math.round((100 * productifTotal) / a.answered) : 0;
  const pctRdv =
    productifTotal > 0
      ? Math.round((100 * (a.rdvConfirme + a.passerHumain)) / productifTotal)
      : 0;
  return [
    { label: t.funnelLabels[0], count: a.total },
    { label: t.funnelLabels[1], count: a.answered, pct: `${pctAnswered} %` },
    { label: t.funnelLabels[2], count: productifTotal, pct: `${pctProductif} %` },
    { label: t.funnelLabels[3], count: a.rdvConfirme + a.passerHumain, pct: `${pctRdv} %` },
  ];
}

async function buildActionTiers(orgId: string, t: typeof T["fr"]): Promise<{
  tiers: ActionTier[];
  callbacksDue: number;
  topCallbackNames: string[];
}> {
  const dueRows = await loadLeadsDueForCallback(orgId);
  const overDialed = await loadOverDialedLeads();

  const tiers: ActionTier[] = [];

  if (dueRows.length > 0) {
    tiers.push({
      priority: 1,
      title: t.callbackTierTitle,
      rows: dueRows.slice(0, 15).map((r) => ({
        name: r.nom ?? "—",
        phone: fmtPhone(r.numero_telephone),
        reason: t.callbackReason(r.call_count ?? 0),
        when: r.rappel_rdv ? fmtAgo(r.rappel_rdv) : "Aujourd'hui",
        urgency: "haute",
      })),
    });
  }

  if (overDialed.length > 0) {
    tiers.push({
      priority: 2,
      title: t.overDialedTierTitle,
      rows: overDialed.slice(0, 10).map((r) => ({
        name: r.nom ?? "—",
        phone: fmtPhone(r.numero_telephone),
        reason: t.overDialedReason(r.call_count ?? 0, r.qualification ?? "inconnue"),
        when: fmtAgo(r.last_call_datetime),
        urgency: "moy",
      })),
    });
  }

  const topCallbackNames = dueRows.slice(0, 5).map((r) => r.nom ?? "");

  return {
    tiers,
    callbacksDue: dueRows.length,
    topCallbackNames,
  };
}

function buildAnnexes(a: CallAggregates, t: typeof T["fr"]): AnnexSection[] {
  // Hourly distribution (top 6 active hours) — useful for "best slot to call"
  // discussions, mapped to UK/Maurice times.
  const hours = a.byHourUtc
    .map((count, hour) => ({ hour, count }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  if (hours.length === 0) return [];
  return [
    {
      tone: "info",
      letter: "A",
      heading: t.annexHeading,
      subheading: t.annexSub,
      columns: t.annexCols,
      rows: hours.map((h) => ({
        h_utc: `${String(h.hour).padStart(2, "0")}:00`,
        h_uk: `${String((h.hour + 1) % 24).padStart(2, "0")}:00`,
        h_mu: `${String((h.hour + 4) % 24).padStart(2, "0")}:00`,
        count: String(h.count),
      })),
    },
  ];
}

// ── Public entry point ───────────────────────────────────────────────────────

export async function buildPilotageHebdo(args: {
  orgId: string;
  period: ReportPeriod;
  lang?: "fr" | "en";
  type?: "pilotage_hebdo" | "bilan_mensuel";
}): Promise<ReportPayload> {
  const lang = args.lang ?? "fr";
  const t = T[lang];
  const reportType = args.type ?? "pilotage_hebdo";

  // Override title/subtitle for bilan_mensuel
  let title = t.reportTitle;
  let subtitle = t.reportSubtitle;
  if (reportType === "bilan_mensuel") {
    if (lang === "en") {
      title = "Monthly Prospecting Summary";
      subtitle = "Month performance analysis — calls, conversions, pipeline";
    } else {
      title = "Bilan mensuel de prospection";
      subtitle = "Analyse des performances du mois — appels, conversions, pipeline";
    }
  }

  const agg = await loadCallAggregates(args.orgId, {
    fromIso: args.period.from,
    toIso: args.period.to,
  });
  const actions = await buildActionTiers(args.orgId, t);

  const narrative = await generateNarrative({
    reportTitle: t.narrativeTitle,
    periodLabel: args.period.label,
    agg,
    callbacksDue: actions.callbacksDue,
    overDialed: actions.tiers.find((tier) => tier.priority === 2)?.rows.length ?? 0,
    topCallbackNames: actions.topCallbackNames,
    lang,
  });

  return {
    type: reportType,
    title,
    subtitle,
    generatedAt: fmtFR(new Date()),
    period: args.period,
    lang,
    meta: [
      { label: "Période", value: args.period.label },
      { label: "Volume", value: t.metaVolume(agg.total) },
      { label: t.metaAnswered, value: `${agg.answered}` },
      { label: "Pipeline actif", value: t.metaPipeline(actions.callbacksDue) },
      { label: "Statut", value: t.metaStatus },
    ],
    synthese: narrative.synthese,
    execMessages: narrative.execMessages,
    funnel: buildFunnel(agg, t),
    kpis: buildKpis(agg, t),
    actionTiers: actions.tiers,
    vigilance: narrative.vigilance,
    annexes: buildAnnexes(agg, t),
    methodNote: narrative.methodNote,
  };
}
