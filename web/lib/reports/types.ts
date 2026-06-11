/**
 * Shared types for the pilotage reports generator. The viewer consumes a
 * `ReportPayload`; each report template (pilotage hebdomadaire, bilan
 * mensuel, performance par agent, funnel campagne, NHS S2) produces one.
 *
 * The shape is intentionally generic so a single React viewer can render
 * any of the templates — only the headings, narratives and the action
 * tiers vary.
 */

export type ReportType =
  | "pilotage_hebdo"
  | "bilan_mensuel"
  | "perf_par_agent"
  | "funnel_campagne"
  | "nhs_s2";

export interface ReportPeriod {
  /** ISO start (UTC). */
  from: string;
  /** ISO end (UTC, exclusive). */
  to: string;
  /** Human label rendered in the masthead (e.g. "Semaine du 04 au 11 juin"). */
  label: string;
}

export interface Kpi {
  /** Tiny label above the value ("Total appels", "Taux décroché"). */
  label: string;
  /** Formatted value ("1 524", "84 %", "$1.80"). */
  value: string;
  /** Optional second-line context ("vs semaine précédente : +12 %"). */
  hint?: string;
  /** Visual tone for the colored top border. */
  tone?: "neutral" | "good" | "warn" | "bad";
}

export interface FunnelStage {
  /** Stage name ("Soumis", "Décrochés", "Qualifiés", "RDV"). */
  label: string;
  /** Raw count. */
  count: number;
  /** Optional % of the previous stage ("84 % des décidés"). */
  pct?: string;
}

export interface ExecMessage {
  tone: "good" | "warn" | "info" | "bad";
  /** Short heading ("Ce qui fonctionne"). */
  heading: string;
  /** Big number/word ("84 %"). */
  big: string;
  /** Narrative body — 1-2 sentences. AI-generated. */
  body: string;
}

export interface ActionRow {
  /** Patient/lead/contact name. */
  name: string;
  /** Phone number. */
  phone?: string;
  /** Free-text reason / what's blocking. */
  reason: string;
  /** When to act ("Aujourd'hui", "Cette semaine", "24/06"). */
  when?: string;
  /** Tone for the urgency pill. */
  urgency?: "haute" | "moy" | "surv" | "green";
}

export interface ActionTier {
  /** 1-4: drives the priority color band. */
  priority: 1 | 2 | 3 | 4;
  /** Headline ("À rappeler aujourd'hui — fenêtre immédiate"). */
  title: string;
  /** Row list. */
  rows: ActionRow[];
}

export interface VigilanceFlag {
  tone: "bad" | "warn" | "info";
  heading: string;
  body: string;
  /** Optional "Levier →" recommendation. */
  fix?: string;
}

export interface AnnexSection {
  /** Letter chip color. */
  tone: "good" | "info" | "warn" | "bad" | "neutral";
  /** Letter ("A", "B"…). */
  letter: string;
  heading: string;
  subheading?: string;
  rows: Array<Record<string, string>>;
  columns: Array<{ key: string; label: string }>;
}

export interface ReportPayload {
  type: ReportType;
  title: string;
  subtitle: string;
  /** Pre-formatted ("9 juin 2026"). */
  generatedAt: string;
  period: ReportPeriod;
  /** Free-form meta entries that render in the masthead row. */
  meta: Array<{ label: string; value: string }>;
  /** Section 01: 1-2 sentence lead paragraph (AI). */
  synthese: string;
  /** 3 boxes under the lead paragraph. */
  execMessages: ExecMessage[];
  funnel: FunnelStage[];
  /** Section 02: 4 KPIs in a row. */
  kpis: Kpi[];
  /** Section 04: action tiers (1-3 most of the time). */
  actionTiers: ActionTier[];
  /** Section 05: 2-4 vigilance flags. */
  vigilance: VigilanceFlag[];
  /** Section 06: detailed tables. Optional, can be empty. */
  annexes: AnnexSection[];
  /** Method note at the bottom. */
  methodNote: string;
}
