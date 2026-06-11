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

function buildKpis(a: CallAggregates): Kpi[] {
  const pctDecroche = a.total > 0 ? Math.round((100 * a.answered) / a.total) : 0;
  const pctProductif =
    a.answered > 0
      ? Math.round((100 * (a.rappel + a.rdvConfirme + a.passerHumain)) / a.answered)
      : 0;
  const productifTotal = a.rappel + a.rdvConfirme + a.passerHumain;
  return [
    {
      label: "Total appels passés",
      value: a.total.toLocaleString("fr-FR"),
      hint: `${a.answered} décrochés · ${a.unanswered} non répondus`,
      tone: "neutral",
    },
    {
      label: "Taux de décroché",
      value: `${pctDecroche} %`,
      hint: `${a.answered} sur ${a.total}`,
      tone: pctDecroche >= 25 ? "good" : pctDecroche >= 15 ? "warn" : "bad",
    },
    {
      label: "Qualif productive",
      value: `${pctProductif} %`,
      hint: `${productifTotal} pistes actives (RAPPEL+RDV+humain)`,
      tone: pctProductif >= 40 ? "good" : pctProductif >= 25 ? "warn" : "bad",
    },
    {
      label: "RDV + Humain",
      value: `${a.rdvConfirme + a.passerHumain}`,
      hint: `${a.rdvConfirme} RDV · ${a.passerHumain} à passer humain`,
      tone: "good",
    },
  ];
}

function buildFunnel(a: CallAggregates): FunnelStage[] {
  const productifTotal = a.rappel + a.rdvConfirme + a.passerHumain;
  const pctAnswered = a.total > 0 ? Math.round((100 * a.answered) / a.total) : 0;
  const pctProductif =
    a.answered > 0 ? Math.round((100 * productifTotal) / a.answered) : 0;
  const pctRdv =
    productifTotal > 0
      ? Math.round((100 * (a.rdvConfirme + a.passerHumain)) / productifTotal)
      : 0;
  return [
    { label: "Appels passés", count: a.total },
    { label: "Décrochés", count: a.answered, pct: `${pctAnswered} %` },
    { label: "Qualif productive", count: productifTotal, pct: `${pctProductif} %` },
    { label: "RDV + Humain", count: a.rdvConfirme + a.passerHumain, pct: `${pctRdv} %` },
  ];
}

async function buildActionTiers(orgId: string): Promise<{
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
      title: "Rappels échus à traiter — fenêtre immédiate",
      rows: dueRows.slice(0, 15).map((r) => ({
        name: r.nom ?? "—",
        phone: fmtPhone(r.numero_telephone),
        reason: `RAPPEL programmé · ${r.call_count ?? 0} tentatives jusqu'ici`,
        when: r.rappel_rdv ? fmtAgo(r.rappel_rdv) : "Aujourd'hui",
        urgency: "haute",
      })),
    });
  }

  if (overDialed.length > 0) {
    tiers.push({
      priority: 2,
      title: "Sur-appelés sans qualif — arbitrer ou clôturer",
      rows: overDialed.slice(0, 10).map((r) => ({
        name: r.nom ?? "—",
        phone: fmtPhone(r.numero_telephone),
        reason: `${r.call_count ?? 0} tentatives · qualif ${r.qualification ?? "inconnue"}`,
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

function buildAnnexes(a: CallAggregates): AnnexSection[] {
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
      heading: "Volume d'appels par heure (UTC)",
      subheading: "Top des heures les plus actives sur la période, en UTC.",
      columns: [
        { key: "h_utc", label: "Heure UTC" },
        { key: "h_uk", label: "Heure UK" },
        { key: "h_mu", label: "Heure Maurice" },
        { key: "count", label: "Appels" },
      ],
      rows: hours.map((h) => ({
        h_utc: `${String(h.hour).padStart(2, "0")}:00`,
        h_uk: `${String((h.hour + 1) % 24).padStart(2, "0")}:00`,
        h_mu: `${String((h.hour + 4) % 24).padStart(2, "0")}:00`,
        count: String(h.count),
      })),
    },
  ];
}

export async function buildPilotageHebdo(args: {
  orgId: string;
  period: ReportPeriod;
}): Promise<ReportPayload> {
  const agg = await loadCallAggregates(args.orgId, {
    fromIso: args.period.from,
    toIso: args.period.to,
  });
  const actions = await buildActionTiers(args.orgId);

  const narrative = await generateNarrative({
    reportTitle: "Pilotage hebdomadaire de la prospection",
    periodLabel: args.period.label,
    agg,
    callbacksDue: actions.callbacksDue,
    overDialed: actions.tiers.find((t) => t.priority === 2)?.rows.length ?? 0,
    topCallbackNames: actions.topCallbackNames,
  });

  return {
    type: "pilotage_hebdo",
    title: "Rapport hebdomadaire de prospection",
    subtitle: "Pilotage des appels Axon — du suivi descriptif à l'action",
    generatedAt: fmtFR(new Date()),
    period: args.period,
    meta: [
      { label: "Période", value: args.period.label },
      { label: "Volume", value: `${agg.total.toLocaleString("fr-FR")} appels` },
      { label: "Décrochés", value: `${agg.answered}` },
      { label: "Pipeline actif", value: `${actions.callbacksDue} à rappeler` },
      { label: "Statut", value: "Confidentiel — usage interne" },
    ],
    synthese: narrative.synthese,
    execMessages: narrative.execMessages,
    funnel: buildFunnel(agg),
    kpis: buildKpis(agg),
    actionTiers: actions.tiers,
    vigilance: narrative.vigilance,
    annexes: buildAnnexes(agg),
    methodNote: narrative.methodNote,
  };
}
