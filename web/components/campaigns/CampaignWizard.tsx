"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DynamicEngineConfig, defaultEngineConfig, type EngineConfig } from "./DynamicEngineConfig";
import { PreflightPanel } from "./PreflightPanel";
import { preflightCampaign, isPreflightClear, blockingChecks } from "@/lib/sentinel/preflight";
import { ScheduleChatPanel, type ScheduleChatContext, type FinalizeResult } from "./ScheduleChatPanel";
import type { NormalizedSchedule } from "@/lib/campaigns/schedule-proposal";
import { useT } from "@/lib/i18n";

export interface AgentHandleOption {
  id: string;
  display_name: string;
  /** 'ai' = the AI agent speaks; 'human' = a desk campaign that connects each
   *  answered lead to this human agent's softphone (they must be online). */
  kind?: "ai" | "human";
  llm_model: string | null;
  tts_voice_id: string | null;
  /** Wave 1 preflight: true when the referenced `agents.system_prompt` (or
   *  `prompt`/`instructions`) is non-empty. Surfaced in the wizard so the
   *  preflight panel can flag agents without a prompt before submit. */
  has_prompt?: boolean;
}

export interface PhoneNumberOption {
  id: string;
  e164: string;
  label: string | null;
  active: boolean;
}

export interface ContactOption {
  id: string;
  e164: string;
  display_name: string | null;
}

export interface ScriptOption {
  id: string;
  name: string;
  mission: string | null;
  description: string | null;
}

export interface TeamOption {
  id: string;
  name: string;
  description: string | null;
  /** The agent_handle id of the team's lead — auto-selected when the user
   *  picks a team, so they don't also need to pick an answering agent. */
  lead_agent_handle_id: string | null;
  member_count: number;
}

export interface ContactListOption {
  id: string;
  name: string;
  description: string | null;
  contact_count: number;
}

export interface DataTableOption {
  id: string;
  label: string;
  physical_table: string;
  row_count: number;
  columns: Array<{ key: string; label: string; type: string }>;
  phone_column: string;
}

interface Target {
  e164: string;
  name: string | null;
}

/** A Twilio Content template, as returned by /api/twilio/content-templates. */
interface ContentTemplate {
  sid: string;
  friendly_name: string;
  language: string | null;
  variables: string[];
  body: string | null;
  type_keys: string[];
}

const DAYS = [
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mer" },
  { id: 4, label: "Jeu" },
  { id: 5, label: "Ven" },
  { id: 6, label: "Sam" },
  { id: 0, label: "Dim" },
];

const STORAGE_KEY = "axon.campaign.wizard.draft";

// Concurrent-stream ceiling imposed by the upstream STT provider's plan
// (AssemblyAI). Surface a warning when the user picks a higher concurrency.
// Free tier = 5; bump via env when the org upgrades.
const PLAN_CONCURRENCY_LIMIT = Number(
  process.env.NEXT_PUBLIC_STT_CONCURRENT_LIMIT ?? 5,
);

// Timezone-aware schedule: the dialer compares with UTC, but users think in
// local time. The wizard lets them pick a timezone, enter HH:MM in that local
// time, and converts to UTC on submit. Grouped by region for fast lookup.
type TimezoneItem = { id: string; label: string };
const TIMEZONE_GROUPS: { group: string; items: TimezoneItem[] }[] = [
  {
    group: "Afrique & Océan Indien",
    items: [
      { id: "Indian/Mauritius",    label: "Maurice (UTC+4)" },
      { id: "Indian/Reunion",      label: "La Réunion (UTC+4)" },
      { id: "Indian/Mayotte",      label: "Mayotte (UTC+3)" },
      { id: "Indian/Antananarivo", label: "Madagascar (UTC+3)" },
      { id: "Africa/Casablanca",   label: "Maroc (UTC+1)" },
      { id: "Africa/Tunis",        label: "Tunisie (UTC+1)" },
      { id: "Africa/Algiers",      label: "Algérie (UTC+1)" },
      { id: "Africa/Cairo",        label: "Égypte (UTC+2)" },
      { id: "Africa/Dakar",        label: "Sénégal (UTC+0)" },
      { id: "Africa/Abidjan",      label: "Côte d'Ivoire (UTC+0)" },
      { id: "Africa/Lagos",        label: "Nigéria (UTC+1)" },
      { id: "Africa/Johannesburg", label: "Afrique du Sud (UTC+2)" },
      { id: "Africa/Nairobi",      label: "Kenya (UTC+3)" },
    ],
  },
  {
    group: "Europe",
    items: [
      { id: "Europe/Paris",     label: "France (UTC+1/+2)" },
      { id: "Europe/Brussels",  label: "Belgique (UTC+1/+2)" },
      { id: "Europe/Luxembourg",label: "Luxembourg (UTC+1/+2)" },
      { id: "Europe/Zurich",    label: "Suisse (UTC+1/+2)" },
      { id: "Europe/London",    label: "Royaume-Uni (UTC+0/+1)" },
      { id: "Europe/Dublin",    label: "Irlande (UTC+0/+1)" },
      { id: "Europe/Lisbon",    label: "Portugal (UTC+0/+1)" },
      { id: "Europe/Madrid",    label: "Espagne (UTC+1/+2)" },
      { id: "Europe/Berlin",    label: "Allemagne (UTC+1/+2)" },
      { id: "Europe/Amsterdam", label: "Pays-Bas (UTC+1/+2)" },
      { id: "Europe/Rome",      label: "Italie (UTC+1/+2)" },
      { id: "Europe/Vienna",    label: "Autriche (UTC+1/+2)" },
      { id: "Europe/Warsaw",    label: "Pologne (UTC+1/+2)" },
      { id: "Europe/Stockholm", label: "Suède (UTC+1/+2)" },
      { id: "Europe/Helsinki",  label: "Finlande (UTC+2/+3)" },
      { id: "Europe/Athens",    label: "Grèce (UTC+2/+3)" },
      { id: "Europe/Istanbul",  label: "Turquie (UTC+3)" },
      { id: "Europe/Moscow",    label: "Russie — Moscou (UTC+3)" },
    ],
  },
  {
    group: "Amériques",
    items: [
      { id: "America/St_Johns",      label: "Terre-Neuve (UTC-3:30/-2:30)" },
      { id: "America/Halifax",       label: "Halifax (UTC-4/-3)" },
      { id: "America/Toronto",       label: "Toronto / Montréal (UTC-5/-4)" },
      { id: "America/New_York",      label: "New York (UTC-5/-4)" },
      { id: "America/Chicago",       label: "Chicago (UTC-6/-5)" },
      { id: "America/Denver",        label: "Denver (UTC-7/-6)" },
      { id: "America/Phoenix",       label: "Phoenix (UTC-7)" },
      { id: "America/Los_Angeles",   label: "Los Angeles (UTC-8/-7)" },
      { id: "America/Anchorage",     label: "Alaska (UTC-9/-8)" },
      { id: "Pacific/Honolulu",      label: "Hawaï (UTC-10)" },
      { id: "America/Mexico_City",   label: "Mexique (UTC-6/-5)" },
      { id: "America/Bogota",        label: "Colombie (UTC-5)" },
      { id: "America/Lima",          label: "Pérou (UTC-5)" },
      { id: "America/Caracas",       label: "Venezuela (UTC-4)" },
      { id: "America/Santiago",      label: "Chili (UTC-4/-3)" },
      { id: "America/Argentina/Buenos_Aires", label: "Argentine (UTC-3)" },
      { id: "America/Sao_Paulo",     label: "Brésil — São Paulo (UTC-3)" },
    ],
  },
  {
    group: "Asie & Moyen-Orient",
    items: [
      { id: "Asia/Jerusalem",  label: "Israël (UTC+2/+3)" },
      { id: "Asia/Beirut",     label: "Liban (UTC+2/+3)" },
      { id: "Asia/Riyadh",     label: "Arabie Saoudite (UTC+3)" },
      { id: "Asia/Dubai",      label: "Dubaï / Émirats (UTC+4)" },
      { id: "Asia/Tehran",     label: "Iran (UTC+3:30)" },
      { id: "Asia/Karachi",    label: "Pakistan (UTC+5)" },
      { id: "Asia/Kolkata",    label: "Inde (UTC+5:30)" },
      { id: "Asia/Dhaka",      label: "Bangladesh (UTC+6)" },
      { id: "Asia/Bangkok",    label: "Thaïlande (UTC+7)" },
      { id: "Asia/Ho_Chi_Minh",label: "Vietnam (UTC+7)" },
      { id: "Asia/Jakarta",    label: "Indonésie — Jakarta (UTC+7)" },
      { id: "Asia/Singapore",  label: "Singapour (UTC+8)" },
      { id: "Asia/Hong_Kong",  label: "Hong Kong (UTC+8)" },
      { id: "Asia/Shanghai",   label: "Chine (UTC+8)" },
      { id: "Asia/Manila",     label: "Philippines (UTC+8)" },
      { id: "Asia/Taipei",     label: "Taïwan (UTC+8)" },
      { id: "Asia/Seoul",      label: "Corée du Sud (UTC+9)" },
      { id: "Asia/Tokyo",      label: "Japon (UTC+9)" },
    ],
  },
  {
    group: "Océanie",
    items: [
      { id: "Australia/Perth",   label: "Perth (UTC+8)" },
      { id: "Australia/Adelaide",label: "Adélaïde (UTC+9:30/+10:30)" },
      { id: "Australia/Sydney",  label: "Sydney / Melbourne (UTC+10/+11)" },
      { id: "Pacific/Noumea",    label: "Nouvelle-Calédonie (UTC+11)" },
      { id: "Pacific/Auckland",  label: "Nouvelle-Zélande (UTC+12/+13)" },
      { id: "Pacific/Tahiti",    label: "Tahiti (UTC-10)" },
    ],
  },
  {
    group: "Référence",
    items: [
      { id: "UTC", label: "UTC (aucune conversion)" },
    ],
  },
];

// Flat lookup: id -> label, for showing the chosen TZ in the recap.
const TZ_LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  TIMEZONE_GROUPS.flatMap((g) => g.items.map((tz) => [tz.id, tz.label] as const)),
);

// Offset in minutes from UTC for `tz` at `date`. Positive = east of UTC.
// Handles DST automatically thanks to Intl.DateTimeFormat.
function tzOffsetMinutes(tz: string, date: Date = new Date()): number {
  if (tz === "UTC") return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return Math.round((asIfUtc - date.getTime()) / 60000);
}

// Convert HH:MM in `tz` → HH:MM UTC.
function localToUtc(localTime: string, tz: string): string {
  const offset = tzOffsetMinutes(tz);
  const [h, m] = (localTime || "00:00").split(":").map((x) => Number(x) || 0);
  let utcMin = h * 60 + m - offset;
  utcMin = ((utcMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(utcMin / 60)).padStart(2, "0")}:${String(utcMin % 60).padStart(2, "0")}`;
}

function parseCsv(text: string): Target[] {
  const out: Target[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Skip a header row if it obviously is one.
    if (/^e?\.?164.*,/i.test(line) || /phone.*,/i.test(line)) continue;
    const parts = line.split(",").map((s) => s.trim());
    const e164 = parts[0];
    const name = parts[1] || null;
    if (!e164) continue;
    if (!/^\+?[0-9]{6,}$/.test(e164.replace(/\s+/g, ""))) continue;
    const normalized = e164.startsWith("+") ? e164 : `+${e164}`;
    out.push({ e164: normalized.replace(/\s+/g, ""), name });
  }
  return out;
}

/**
 * Picks a Twilio Content template (SMS or WhatsApp) from a dropdown, with a
 * manual "saisir un SID" escape hatch — and a graceful fallback to a raw input
 * when Twilio returned no templates (not configured / none approved). The
 * selected template's body is previewed so the operator confirms the wording.
 */
function ContentSidPicker({
  channel,
  templates,
  templatesLoaded,
  value,
  onChange,
}: {
  channel: string;
  templates: ContentTemplate[];
  templatesLoaded: boolean;
  value: string;
  onChange: (sid: string) => void;
}) {
  const t = useT();
  const known = templates.find((tpl) => tpl.sid === value) ?? null;
  const noTemplates = templatesLoaded && templates.length === 0;
  // Manual when the operator asked for it, or a value is set that isn't a known
  // template (e.g. a legacy SID), or Twilio returned nothing.
  const [manual, setManual] = useState<boolean>(Boolean(value) && templatesLoaded && !known);
  const useManual = manual || noTemplates;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {!useManual ? (
        <>
          <select
            value={known ? value : ""}
            onChange={(e) => {
              if (e.target.value === "__manual__") {
                setManual(true);
                onChange("");
              } else {
                onChange(e.target.value);
              }
            }}
          >
            <option value="">{templatesLoaded ? t("— choisir un modèle —") : t("Chargement des modèles…")}</option>
            {templates.map((tpl) => (
              <option key={tpl.sid} value={tpl.sid}>
                {tpl.friendly_name}
                {tpl.language ? ` (${tpl.language})` : ""}
                {tpl.variables.length ? ` · ${tpl.variables.length} var.` : ""}
              </option>
            ))}
            <option value="__manual__">{t("✏️ Autre — saisir un SID manuellement…")}</option>
          </select>
          {known?.body && (
            <div className="muted" style={{ fontSize: 12, fontStyle: "italic", lineHeight: 1.45 }}>
              « {known.body.length > 160 ? `${known.body.slice(0, 160)}…` : known.body} »
            </div>
          )}
        </>
      ) : (
        <>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="HX…"
            style={{ fontFamily: "ui-monospace, monospace" }}
          />
          {!noTemplates && (
            <button
              type="button"
              className="ghost"
              style={{ justifySelf: "start", padding: "4px 10px", fontSize: 12 }}
              onClick={() => {
                setManual(false);
                onChange("");
              }}
            >
              {t("↩ Choisir dans la liste")}
            </button>
          )}
        </>
      )}
      <div className="muted" style={{ fontSize: 12 }}>
        {noTemplates ? (
          t("Aucun modèle ") + channel + t(" récupéré depuis Twilio — saisis le Content SID (HX…) à la main.")
        ) : (
          <>{t("Modèle")} {channel} {t("approuvé dans Twilio. La variable")} {"{{1}}"} {t("reçoit le prénom du patient.")}</>
        )}
      </div>
    </div>
  );
}

/**
 * Human desk campaign "Qui appeler" picker: choose which leads the agent calls
 * by qualification and/or by assignment (the `agent` column). Both write into
 * engineConfig.selection (include_statuses + assigned_column/assigned_values)
 * and combine with AND. Assignment values are often opaque ids, so each is
 * shown with its lead count — the operator recognises a bucket by its size.
 */
function HumanLeadSelection({
  facetQual,
  facetAgent,
  loaded,
  selectedQuals,
  selectedAssigned,
  onToggleQual,
  onToggleAssigned,
}: {
  facetQual: Array<{ value: string; count: number; label?: string }>;
  facetAgent: Array<{ value: string; count: number; label?: string }>;
  loaded: boolean;
  selectedQuals: string[];
  selectedAssigned: string[];
  onToggleQual: (v: string) => void;
  onToggleAssigned: (v: string) => void;
}) {
  const t = useT();
  const nothingSelected = selectedQuals.length === 0 && selectedAssigned.length === 0;
  const chip = (on: boolean): React.CSSProperties => ({
    padding: "6px 10px",
    fontSize: 12,
    borderColor: on ? "var(--accent)" : "var(--border)",
  });
  return (
    <div style={{ display: "grid", gap: 14, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
      <div>
        <h4 style={{ margin: 0, fontSize: 14 }}>{t("👤 Qui appeler — leads de l'agent")}</h4>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {t("Cible les leads par")} <strong>{t("qualification")}</strong> {t("et/ou par")} <strong>{t("assignation")}</strong>. {t("Les deux se combinent (ET).")}
        </div>
      </div>

      {/* Par qualification */}
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t("Par qualification")}</label>
        {facetQual.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>{loaded ? t("Aucune qualification trouvée dans la table.") : t("Chargement…")}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {facetQual.map((f) => {
              const on = selectedQuals.includes(f.value);
              return (
                <button key={f.value} type="button" className={on ? "" : "ghost"} style={chip(on)}
                  onClick={() => onToggleQual(f.value)}>
                  {f.value} <span style={{ opacity: 0.6 }}>· {f.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Par assignation (optionnel) */}
      <details>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {t("Filtrer aussi par assignation (optionnel)")}
        </summary>
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            {t("Restreindre aux leads assignés à un agent précis")} {t("dans la table (colonne « agent »).")}{" "}
            {t("Chaque case = une valeur d'assignation et son nombre de leads.")}
          </div>
          {facetAgent.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>{loaded ? t("Aucune assignation trouvée.") : t("Chargement…")}</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {facetAgent.map((f) => {
                const on = selectedAssigned.includes(f.value);
                return (
                  <button key={f.value} type="button" className={on ? "" : "ghost"} style={chip(on)}
                    title={f.value} onClick={() => onToggleAssigned(f.value)}>
                    {f.label ?? t("Ancien agent")} <span style={{ opacity: 0.6 }}>· {f.count} {t("leads")}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </details>

      {nothingSelected && loaded && (
        <div style={{ fontSize: 12, color: "#b45309" }}>
          {t("⚠️ Aucun filtre : la campagne appellera")} <strong>{t("tous les leads éligibles")}</strong> {t("de la table.")}{" "}
          {t("Choisis au moins une qualification ou une assignation pour ne cibler que les leads de l'agent.")}
        </div>
      )}
    </div>
  );
}

export function CampaignWizard({
  template = null,
  agents,
  numbers,
  contacts,
  scripts = [],
  teams = [],
  contactLists = [],
  dataTables = [],
  orgCategory = null,
}: {
  template?: import("@/lib/campaign-templates").CampaignTemplate | null;
  agents: AgentHandleOption[];
  numbers: PhoneNumberOption[];
  contacts: ContactOption[];
  scripts?: ScriptOption[];
  teams?: TeamOption[];
  contactLists?: ContactListOption[];
  dataTables?: DataTableOption[];
  /** Business vertical of the org — lets the scheduling assistant speak the
   *  client's language (Hôtel, Restaurant, Clinique, Call Center, …). */
  orgCategory?: string | null;
}) {
  const t = useT();
  const router = useRouter();

  // Template-driven defaults (fall back to neutral values when no template).
  const TPL_DEFAULTS = {
    maxConcurrency: template?.defaults.maxConcurrency ?? 5,
    maxAttempts: template?.defaults.maxAttempts ?? 3,
    retryDelayMin: template?.defaults.retryDelayMin ?? 60,
    // New campaigns default to AMD off. Twilio's MachineDetection has too
    // many false positives on real humans who don't speak in the first 1-3s
    // — the agent's STT regex + idle watchdog do the same job without
    // cutting humans off. Templates can still re-enable it explicitly.
    amdEnabled: template?.defaults.amdEnabled ?? false,
    days: template?.defaults.days ?? [1, 2, 3, 4, 5],
    timezone: template?.defaults.timezone ?? "Indian/Mauritius",
    hourStart: template?.defaults.hourStart ?? "09:00",
    hourEnd: template?.defaults.hourEnd ?? "18:00",
  };

  // Pre-fill the name from the chosen template + the current month so the
  // user gets a sensible default like "Confirmation de RDV — Juin 2026".
  // Users routinely rename it; this just removes the empty-field friction.
  const defaultName = template
    ? `${template.title} — ${new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`
    : "";
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  // The user picks EITHER a Team (multi-agent journey, auto-resolves to
  // the lead's handle) OR a single Agent handle. Team takes precedence.
  const [teamId, setTeamId] = useState("");
  const selectedTeam = useMemo(() => teams.find((tm) => tm.id === teamId) ?? null, [teams, teamId]);
  // Human-campaign template pre-selects a human handle so the desk flow shows
  // immediately; otherwise default to the first agent (usually an AI).
  const [agentHandleId, setAgentHandleId] = useState(
    template?.prefer_human
      ? (agents.find((a) => a.kind === "human")?.id ?? agents[0]?.id ?? "")
      : (agents[0]?.id ?? ""),
  );
  const effectiveHandleId = selectedTeam?.lead_agent_handle_id ?? agentHandleId;
  const [scriptId, setScriptId] = useState("");
  // Source for the campaign's targets: a data table (preferred — real table
  // like leads_rdv), or fall back to the legacy CSV paste / contact picker.
  const [contactListId, setContactListId] = useState("");
  // When the org has exactly one data table, auto-select it so the campaign
  // configuration (statuts, volume, relances) is visible immediately instead
  // of hidden behind a dropdown choice.
  const soleTable = dataTables.length === 1 ? dataTables[0] : null;
  const [dataTableId, setDataTableId] = useState(soleTable?.id ?? "");
  const selectedDataTable = useMemo(
    () => dataTables.find((tbl) => tbl.id === dataTableId) ?? null,
    [dataTables, dataTableId],
  );
  // "Continuous" campaign: re-selects from the table at each slot per rules.
  // Defaults ON whenever a table is in play — that's the configurable engine
  // (statuts/volume/relances) clients asked to see by default.
  const [dynamicMode, setDynamicMode] = useState(!!soleTable);
  const [engineConfig, setEngineConfig] = useState<EngineConfig | null>(
    soleTable ? defaultEngineConfig(soleTable.columns, soleTable.phone_column) : null,
  );

  function onPickDataTable(id: string) {
    setDataTableId(id);
    const tbl = dataTables.find((x) => x.id === id);
    if (tbl) {
      setEngineConfig(defaultEngineConfig(tbl.columns, tbl.phone_column));
      setDynamicMode(true); // surface the engine config straight away
    } else {
      setDynamicMode(false);
      setEngineConfig(null);
    }
  }
  const [phoneNumberId, setPhoneNumberId] = useState(numbers[0]?.id ?? "");
  const [callerIdOverride, setCallerIdOverride] = useState("");
  const [csvText, setCsvText] = useState("");
  const [pickedContactIds, setPickedContactIds] = useState<Set<string>>(new Set());
  const [contactSearch, setContactSearch] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState(TPL_DEFAULTS.maxConcurrency);
  const [maxAttempts, setMaxAttempts] = useState(TPL_DEFAULTS.maxAttempts);
  const [retryDelayMin, setRetryDelayMin] = useState(TPL_DEFAULTS.retryDelayMin);
  const [amdEnabled, setAmdEnabled] = useState(TPL_DEFAULTS.amdEnabled);
  const [days, setDays] = useState<number[]>(TPL_DEFAULTS.days);
  // Timezone in which hourStart/hourEnd are expressed. Templates may override.
  const [timezone, setTimezone] = useState(TPL_DEFAULTS.timezone);
  // Multi-range hours per day (real call-center pattern: 10:00–13:00 +
  // 14:00–18:00). The first range is seeded from the template; the user can
  // add more via the step-3 UI. UTC conversion happens on submit.
  type HourRange = { start: string; end: string };
  const [hourRanges, setHourRanges] = useState<HourRange[]>([
    { start: TPL_DEFAULTS.hourStart, end: TPL_DEFAULTS.hourEnd },
  ]);
  const addRange = () =>
    setHourRanges((rs) => [...rs, { start: "14:00", end: "18:00" }]);
  const removeRange = (i: number) =>
    setHourRanges((rs) => (rs.length <= 1 ? rs : rs.filter((_, j) => j !== i)));
  const updateRange = (i: number, patch: Partial<HourRange>) =>
    setHourRanges((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-call message(s) sent ~lead_minutes before each call. SMS and WhatsApp
  // are independent — either, both, or none. Stored in
  // campaigns.metadata.precall_message = { enabled, lead_minutes, sms?, whatsapp? }.
  const [precallSmsOn, setPrecallSmsOn] = useState(false);
  const [precallSmsSid, setPrecallSmsSid] = useState("");
  const [precallSmsFrom, setPrecallSmsFrom] = useState("");
  const [precallWaOn, setPrecallWaOn] = useState(false);
  const [precallWaSid, setPrecallWaSid] = useState("");
  const [precallWaFrom, setPrecallWaFrom] = useState("");
  const [precallLeadMin, setPrecallLeadMin] = useState(2);
  const precallOn = precallSmsOn || precallWaOn;

  // Twilio Content templates — fetched once so the SMS/WhatsApp pickers offer a
  // dropdown of real, approved templates instead of a raw HX… SID field.
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/twilio/content-templates");
        const json = (await res.json()) as { templates?: ContentTemplate[] };
        if (!cancelled) setTemplates(Array.isArray(json.templates) ? json.templates : []);
      } catch {
        /* leave empty → pickers fall back to manual SID entry */
      } finally {
        if (!cancelled) setTemplatesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Human-campaign "Qui appeler" facets: distinct qualification + assignment
  // (agent) values with counts, so the operator targets leads by qualification
  // and/or by who they're assigned to. Loaded only for human desk campaigns.
  const [facetQual, setFacetQual] = useState<Array<{ value: string; count: number; label?: string }>>([]);
  const [facetAgent, setFacetAgent] = useState<Array<{ value: string; count: number; label?: string }>>([]);
  const [facetsLoaded, setFacetsLoaded] = useState(false);

  // Step navigation: 1 = Qui appelle, 2 = Qui appeler, 3 = Quand.
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Step 3 "Quand" is chat-first: the operator describes their cadence to the
  // assistant. They can flip to the classic form to fine-tune by hand.
  const [manualSchedule, setManualSchedule] = useState(false);
  // Real distinct values of the selected table's status column — loaded so the
  // scheduling assistant maps the operator's wording onto THIS client's exact
  // stored values (works for any tenant: hôtel, resto, call center, …).
  const [tableStatusValues, setTableStatusValues] = useState<string[]>([]);

  const statusColumn = engineConfig?.selection.status_column ?? "";
  useEffect(() => {
    if (!dataTableId || !dynamicMode || !statusColumn) {
      setTableStatusValues([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/campaigns/table-statuses?data_table_id=${encodeURIComponent(dataTableId)}&column=${encodeURIComponent(statusColumn)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { values?: unknown };
        if (!cancelled && Array.isArray(json.values)) {
          setTableStatusValues(json.values.filter((v): v is string => typeof v === "string"));
        }
      } catch {
        /* non-blocking: the assistant falls back to asking for statuses */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataTableId, dynamicMode, statusColumn]);

  const selectedAgent = agents.find((a) => a.id === agentHandleId) ?? null;
  // Human-agent campaign: one human, one call at a time → force concurrency 1
  // (otherwise the dialer would race several leads into the agent's desk room).
  const isHumanCampaign = !teamId && selectedAgent?.kind === "human";
  const selectedNumber = numbers.find((n) => n.id === phoneNumberId) ?? null;

  // Load qualification + assignment facets when configuring a human campaign on
  // a data table (the only case the friendly "Qui appeler" pickers are shown).
  useEffect(() => {
    if (!isHumanCampaign || !dataTableId) {
      setFacetQual([]);
      setFacetAgent([]);
      setFacetsLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/campaigns/table-facets?data_table_id=${encodeURIComponent(dataTableId)}&columns=qualification,agent`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          facets?: {
            qualification?: Array<{ value: string; count: number; label?: string }>;
            agent?: Array<{ value: string; count: number; label?: string }>;
          };
        };
        if (cancelled) return;
        setFacetQual(json.facets?.qualification ?? []);
        setFacetAgent(json.facets?.agent ?? []);
      } catch {
        /* non-blocking */
      } finally {
        if (!cancelled) setFacetsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [isHumanCampaign, dataTableId]);

  // Selection helpers for the human "Qui appeler" pickers — they write straight
  // into engineConfig.selection (include_statuses + assigned_column/values).
  const humanQuals = engineConfig?.selection.include_statuses ?? [];
  const humanAssigned = engineConfig?.selection.assigned_values ?? [];
  function toggleHumanQual(v: string) {
    setEngineConfig((prev) => {
      if (!prev) return prev;
      const has = prev.selection.include_statuses.includes(v);
      return {
        ...prev,
        selection: {
          ...prev.selection,
          status_column: prev.selection.status_column || "qualification",
          include_statuses: has
            ? prev.selection.include_statuses.filter((x) => x !== v)
            : [...prev.selection.include_statuses, v],
        },
      };
    });
  }
  function toggleHumanAssigned(v: string) {
    setEngineConfig((prev) => {
      if (!prev) return prev;
      const cur = prev.selection.assigned_values ?? [];
      const has = cur.includes(v);
      const next = has ? cur.filter((x) => x !== v) : [...cur, v];
      return {
        ...prev,
        selection: {
          ...prev.selection,
          assigned_column: next.length > 0 ? "agent" : null,
          assigned_values: next,
        },
      };
    });
  }

  const csvTargets = useMemo(() => parseCsv(csvText), [csvText]);
  const pickedContacts = useMemo(
    () =>
      contacts
        .filter((c) => pickedContactIds.has(c.id))
        .map((c) => ({ e164: c.e164, name: c.display_name })),
    [contacts, pickedContactIds],
  );

  const targets: Target[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Target[] = [];
    for (const tgt of [...csvTargets, ...pickedContacts]) {
      if (seen.has(tgt.e164)) continue;
      seen.add(tgt.e164);
      out.push(tgt);
    }
    return out;
  }, [csvTargets, pickedContacts]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts.slice(0, 50);
    return contacts
      .filter(
        (c) =>
          c.e164.toLowerCase().includes(q) ||
          (c.display_name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [contacts, contactSearch]);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function togglePicked(id: string) {
    setPickedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function persistDraft() {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ name, description, targets }),
      );
    } catch {
      /* ignore quota */
    }
  }

  // Build the payload and POST it. Returns a result object instead of touching
  // UI state or navigating, so BOTH the manual "Créer" button and the chat's
  // finalize_campaign tool can reuse the exact same creation path (single
  // source of truth — same validation, same schedule/engine build).
  async function doCreate(): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!name.trim()) return { ok: false, error: t("Le nom est requis.") };
    if (!effectiveHandleId) {
      return {
        ok: false,
        error: selectedTeam
          ? t("Cette team n'a pas d'agent lead actif. Définissez un lead dans Teams IA.")
          : t("Sélectionnez un agent IA (ou une team)."),
      };
    }
    if (!phoneNumberId && !callerIdOverride) {
      return { ok: false, error: t("Choisissez un numéro émetteur ou un caller-id.") };
    }
    persistDraft();

    // Convert each range's start/end from the user-chosen timezone to UTC
    // before sending — the dialer compares with UTC. The legacy single
    // start/end is preserved as the bounding window so older dialers keep
    // working; new ones honour `ranges` first.
    const utcRanges = hourRanges
      .filter((r) => r.start && r.end)
      .map((r) => ({ start: localToUtc(r.start, timezone), end: localToUtc(r.end, timezone) }));
    const utcStarts = utcRanges.map((r) => r.start).sort();
    const utcEnds = utcRanges.map((r) => r.end).sort();
    const schedule = {
      days,
      hours: {
        start: utcStarts[0] ?? "09:00",
        end: utcEnds[utcEnds.length - 1] ?? "18:00",
        ranges: utcRanges,
      },
    };

    // Single créneaux source of truth: when dynamic mode is on, mirror the
    // step-3 days/timezone/hours into engineConfig.slots so the continuous
    // engine fires at the times the operator actually configured. The hours
    // come from the user's hourRanges START times (in the wizard's local
    // timezone — the engine compares slot times against the same TZ stored
    // in engine.slots.timezone). The template's default slots are only used
    // as a fallback if the user somehow saved zero ranges.
    const userSlotHours = hourRanges
      .filter((r) => r.start)
      .map((r) => r.start)
      .sort();
    const finalEngine = dynamicMode && dataTableId && engineConfig
      ? {
          ...engineConfig,
          // The assignment filter is a human-campaign concept only — strip it
          // from AI campaigns so a stale selection can't narrow them.
          selection: isHumanCampaign
            ? engineConfig.selection
            : { ...engineConfig.selection, assigned_column: null, assigned_values: [] },
          slots: {
            ...engineConfig.slots,
            days,
            timezone,
            hours: userSlotHours.length > 0
              ? userSlotHours
              : (engineConfig.slots.hours.length > 0
                  ? engineConfig.slots.hours
                  : ["09:00"]),
          },
        }
      : null;
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          agent_handle_id: effectiveHandleId,
          agent_team_id: teamId || null,
          script_id: scriptId || null,
          contact_list_id: contactListId || null,
          data_table_id: dataTableId || null,
          mode: dynamicMode && dataTableId ? "dynamic" : "static",
          engine: finalEngine,
          phone_number_id: phoneNumberId || null,
          caller_id_e164: callerIdOverride.trim() || null,
          precall_message: (() => {
            const sms = precallSmsOn && precallSmsSid.trim()
              ? { content_sid: precallSmsSid.trim(), from: precallSmsFrom.trim() || null }
              : null;
            const whatsapp = precallWaOn && precallWaSid.trim()
              ? { content_sid: precallWaSid.trim(), from: precallWaFrom.trim() || null }
              : null;
            if (!sms && !whatsapp) return null;
            return {
              enabled: true,
              lead_minutes: Math.max(1, Math.min(15, precallLeadMin || 2)),
              ...(sms ? { sms } : {}),
              ...(whatsapp ? { whatsapp } : {}),
            };
          })(),
          schedule,
          max_concurrency: isHumanCampaign ? 1 : maxConcurrency,
          max_attempts: maxAttempts,
          retry_delay_min: retryDelayMin,
          amd_enabled: amdEnabled,
          targets,
        }),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
      return { ok: true, id: json.id as string };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("Erreur inconnue") };
    }
  }

  // Manual "Créer en brouillon" button.
  async function submit() {
    setError(null);
    setSubmitting(true);
    const r = await doCreate();
    if (!r.ok) {
      setError(r.error ?? t("Erreur inconnue"));
      setSubmitting(false);
      return;
    }
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    router.push(`/campaigns/${r.id}`);
  }

  // Called by the scheduling chatbot's finalize_campaign tool on the operator's
  // explicit "go". Gated on steps 1-2 + preflight so the conversational path is
  // exactly as safe as the manual button. Returns a result string the agent
  // relays back into the conversation.
  async function finalizeFromChat(): Promise<FinalizeResult> {
    if (!step1Valid) {
      return { ok: false, error: t("Complète d'abord « Qui appelle » (numéro émetteur) à l'étape 1.") };
    }
    if (!step2Valid) {
      return { ok: false, error: t("Choisis d'abord la base de contacts (ou des cibles) à l'étape « Qui appeler ».") };
    }
    if (!preflightClear) {
      const blockers = blockingChecks(preflightResult).map((c) => c.label);
      return {
        ok: false,
        error: blockers.length
          ? `${t("Blocage(s) à corriger avant de créer :")} ${blockers.join(" ; ")}.`
          : t("Des blocages subsistent dans le récap de vérification — corrige-les avant de créer."),
      };
    }
    setError(null);
    setSubmitting(true);
    const r = await doCreate();
    if (!r.ok) {
      setError(r.error ?? t("Erreur inconnue"));
      setSubmitting(false);
      return r;
    }
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    router.push(`/campaigns/${r.id}`);
    return r;
  }

  // Apply a schedule the chatbot proposed to the live wizard state. The recap
  // (section 6) then reflects exactly what the operator is about to confirm.
  function applyChatProposal(s: NormalizedSchedule) {
    setDays(s.days);
    setTimezone(s.timezone);
    setHourRanges(s.hour_ranges.map((r) => ({ start: r.start, end: r.end })));
    if (s.max_concurrency != null) setMaxConcurrency(s.max_concurrency);
    if (s.max_attempts != null) setMaxAttempts(s.max_attempts);
    if (s.retry_delay_min != null) setRetryDelayMin(s.retry_delay_min);
    // Continuous-campaign extras only apply when a data table drives the engine.
    if (dynamicMode && dataTableId) {
      setEngineConfig((prev) => {
        if (!prev) return prev;
        const next: EngineConfig = {
          ...prev,
          selection: {
            ...prev.selection,
            include_statuses: s.include_statuses ?? prev.selection.include_statuses,
          },
          volume: {
            ...prev.volume,
            max_new_per_day: s.max_new_per_day ?? prev.volume.max_new_per_day,
            wave_size: s.wave_size ?? prev.volume.wave_size,
          },
        };
        // Map cumulative relance markers ([1,3,5]) onto the detected phases'
        // wait_business_days (deltas: 1,2,2), capped to however many phases the
        // table actually exposes.
        const markers = s.relance_days_after_first;
        if (markers && markers.length > 0 && prev.cadence.phases.length > 0) {
          const phases = prev.cadence.phases.slice(0, markers.length).map((ph, i) => ({
            ...ph,
            wait_business_days: i === 0 ? markers[0] : markers[i] - markers[i - 1],
          }));
          next.cadence = { ...prev.cadence, enabled: true, phases };
        }
        return next;
      });
    }
  }

  // Per-step validation: gate the "Suivant" button so users don't
  // skip ahead with missing fields.
  const step1Valid = name.trim().length > 0 && Boolean(effectiveHandleId) && Boolean(phoneNumberId || callerIdOverride);
  const step2Valid = Boolean(dataTableId || contactListId || (csvText.trim().length > 0) || pickedContactIds.size > 0);

  // Sentinel Wave 1: run the deterministic preflight against the in-memory
  // draft. The recap surfaces blockers/warnings; the "Créer" button is
  // disabled when any blocker remains unresolved. Server-side re-runs the
  // same checks in /api/campaigns/[id]/start.
  const preflightResult = useMemo(() => {
    return preflightCampaign({
      name,
      agent_handle_id: effectiveHandleId || null,
      agent_team_id: teamId || null,
      phone_number_id: phoneNumberId || null,
      caller_id_e164: callerIdOverride.trim() || null,
      data_table_id: dataTableId || null,
      contact_list_id: contactListId || null,
      csv_text: csvText,
      targets,
      schedule: {
        days,
        hours: {
          start: hourRanges[0]?.start ?? null,
          end: hourRanges[hourRanges.length - 1]?.end ?? null,
          ranges: hourRanges,
        },
      },
      max_concurrency: isHumanCampaign ? 1 : maxConcurrency,
      max_attempts: maxAttempts,
      retry_delay_min: retryDelayMin,
      amd_enabled: amdEnabled,
      // Human desk campaigns have no AI prompt/voice — tell preflight to skip
      // those AI-only blockers, otherwise a human campaign can never be created.
      is_human_agent: isHumanCampaign,
      // The wizard doesn't have the raw agent row — pass a derived snapshot
      // built from the AgentHandleOption (page-loader fetched `has_prompt`
      // and `tts_voice_id` already). When the prompt is non-empty we feed a
      // sentinel string so the rule sees "non-empty"; the server check uses
      // the real DB row.
      agent: selectedAgent
        ? {
            prompt: selectedAgent.has_prompt ? "filled" : "",
            tts_voice_id: selectedAgent.tts_voice_id,
          }
        : null,
      // Same trick for the phone number: the wizard already filters numbers
      // to active=true (cf. wizard page loader), so any selected row is
      // active by construction.
      phoneNumber: selectedNumber
        ? { active: selectedNumber.active, e164: selectedNumber.e164 }
        : null,
    });
  }, [
    name, effectiveHandleId, teamId, phoneNumberId, callerIdOverride,
    dataTableId, contactListId, csvText, targets,
    days, hourRanges,
    maxConcurrency, maxAttempts, retryDelayMin, amdEnabled,
    selectedAgent, selectedNumber,
  ]);

  const preflightClear = isPreflightClear(preflightResult);

  // Context handed to the scheduling chatbot. Intentionally derived from STABLE
  // campaign facts only (mode + table) — NOT from the live timezone/engine —
  // so that applying a proposal doesn't change this object's identity and tear
  // down the in-flight conversation.
  const scheduleChatContext: ScheduleChatContext = useMemo(() => {
    const cols = selectedDataTable?.columns ?? [];
    const statusCol =
      cols.find((c) => /qualif|status|statut|stage/i.test(c.key))?.key ?? null;
    const relancePhases = cols.filter((c) =>
      /^(date_j\d+|appel_j\d+|phase\d+_called_at|relance_\d+_date|j\d+_called_at)$/i.test(c.key),
    ).length;
    return {
      mode: dynamicMode && dataTableId ? "dynamic" : "static",
      default_timezone: TPL_DEFAULTS.timezone,
      table_label: selectedDataTable?.label ?? null,
      status_column: statusCol,
      status_values: tableStatusValues,
      detected_relance_phases: selectedDataTable ? relancePhases : null,
      concurrency_limit: PLAN_CONCURRENCY_LIMIT,
      org_category: orgCategory,
      is_human_campaign: isHumanCampaign,
      human_agent_name: isHumanCampaign ? (selectedAgent?.display_name ?? null) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicMode, dataTableId, selectedDataTable, tableStatusValues, orgCategory, isHumanCampaign, selectedAgent]);

  const STEPS: { n: 1 | 2 | 3; label: string; icon: string }[] = [
    { n: 1, label: "Qui appelle ?", icon: "🎙" },
    { n: 2, label: "Qui appeler ?", icon: "👥" },
    { n: 3, label: "Quand ?", icon: "🕒" },
  ];

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      {/* Below 760px the wizard's multi-column input grids collapse to a
          single column, and the stepper buttons wrap their labels under
          the step number so they remain tappable on phones. */}
      <style>{`
        .wizard-row-2, .wizard-row-3 { display: grid; gap: 12px; }
        .wizard-row-2 { grid-template-columns: 1fr 1fr; }
        .wizard-row-3 { grid-template-columns: 1fr 1fr 1fr; }
        @media (max-width: 760px) {
          .wizard-row-2, .wizard-row-3 { grid-template-columns: 1fr; }
          .wizard-stepper { flex-wrap: wrap; }
          .wizard-stepper > button { flex: 1 1 100%; justify-content: flex-start !important; }
          .wizard-nav { flex-wrap: wrap; gap: 8px; }
          .wizard-nav > .wizard-nav-label { order: 3; flex: 1 1 100%; text-align: center; }
        }
      `}</style>
      {/* Stepper */}
      <div className="card wizard-stepper" style={{ display: "flex", gap: 8, padding: 10, alignItems: "stretch" }}>
        {STEPS.map((s, i) => {
          const isCurrent = currentStep === s.n;
          const isDone = currentStep > s.n;
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => setCurrentStep(s.n)}
              className={isCurrent || isDone ? "" : "ghost"}
              style={{
                flex: 1,
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "center",
                borderColor: isCurrent ? "var(--accent)" : undefined,
                opacity: isDone ? 0.85 : 1,
              }}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span
                style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: isCurrent ? "var(--accent)" : isDone ? "var(--good)" : "var(--bg-2)",
                  color: isCurrent || isDone ? "#fff" : "var(--text)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                }}
              >
                {isDone ? "✓" : s.n}
              </span>
              <span style={{ fontSize: 13 }}>{s.icon} {t(s.label)}</span>
            </button>
          );
        })}
      </div>

      {/* ─── STEP 1: Qui appelle ? ────────────────────────────────────── */}
      {currentStep === 1 && (<>
      {/* 1. Identité */}
      <section className="card">
        <h3>{t("1. Nom de la campagne")}</h3>
        <div className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          {t("Un nom clair pour la retrouver dans la liste.")}
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr" }}>
          <div>
            <label>{t("Nom *")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Relance client Q2")}
            />
          </div>
          <div>
            <label>{t("Description")}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("Objectif de la campagne, message clé…")}
            />
          </div>
        </div>
      </section>

      {/* 2. Qui répond ? — binary choice: single agent vs multi-agent journey */}
      <section className="card">
        <h3>{t("2. Qui passe les appels ?")}</h3>
        <div className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          {t("L'agent IA — ou une équipe d'agents qui se passent le relais — qui parlera au téléphone.")}
        </div>

        {agents.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {t("Aucun agent IA disponible. Créez-en un depuis la page Agents.")}
          </p>
        ) : (
          <>
            {/* Mode selector — two clear radio cards. */}
            <div className="wizard-row-2" style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                  padding: 12, borderRadius: 8,
                  border: `1px solid ${!teamId ? "var(--accent)" : "var(--border)"}`,
                  background: !teamId ? "var(--accent-soft)" : "var(--bg-2)",
                }}
              >
                <input
                  type="radio"
                  name="answer_mode"
                  checked={!teamId}
                  onChange={() => setTeamId("")}
                  style={{ width: "auto", marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{t("Un seul agent")}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {t("Le même agent gère tout l'appel du début à la fin.")}
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  cursor: teams.length > 0 ? "pointer" : "not-allowed",
                  opacity: teams.length > 0 ? 1 : 0.5,
                  padding: 12, borderRadius: 8,
                  border: `1px solid ${teamId ? "var(--accent)" : "var(--border)"}`,
                  background: teamId ? "var(--accent-soft)" : "var(--bg-2)",
                }}
              >
                <input
                  type="radio"
                  name="answer_mode"
                  checked={!!teamId}
                  disabled={teams.length === 0}
                  onChange={() => {
                    const first = teams[0];
                    if (first) {
                      setTeamId(first.id);
                      if (first.lead_agent_handle_id) setAgentHandleId(first.lead_agent_handle_id);
                    }
                  }}
                  style={{ width: "auto", marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{t("Parcours multi-agents")}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {t("Plusieurs agents se passent le relais (ex : Charlotte → Isabelle → Victoria).")}
                    {teams.length === 0 && t(" — créez d'abord une Team IA.")}
                  </div>
                </div>
              </label>
            </div>

            {/* Single-agent picker */}
            {!teamId && (
              <div>
                <label>{t("Agent")}</label>
                <select value={agentHandleId} onChange={(e) => setAgentHandleId(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.kind === "human" ? "👤 " : "🤖 "}{a.display_name}{a.kind === "human" ? t(" (humain)") : ""}
                    </option>
                  ))}
                </select>
                {selectedAgent && (selectedAgent.kind === "human" ? (
                  <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                    👤 <strong>{t("Campagne agent humain.")}</strong> {t("Depuis")}{" "}
                    <a href="/desk" target="_blank" rel="noreferrer" style={{ color: "var(--accent-2)" }}>{t("Mon poste")}</a>,
                    {" "}<strong>{selectedAgent.display_name}</strong> {t("active la campagne : le système")}{" "}
                    <strong>{t("présente le prochain lead")}</strong> {t("(et envoie le SMS/WhatsApp si activé ci-dessous),")}{" "}
                    {t("puis")} <strong>{t("l'agent clique pour appeler")}</strong> {t("lui-même. Après chaque appel, il qualifie")}{" "}
                    {t("et le")} <strong>{t("lead suivant s'affiche")}</strong>. {t("Le système n'appelle jamais tout seul.")}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    {t("Modèle :")} <span className="kbd">{selectedAgent.llm_model ?? "—"}</span>
                    {" · "}
                    {t("Voix :")} <span className="kbd">{selectedAgent.tts_voice_id ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Multi-agent (team) picker */}
            {teamId && (
              <div>
                <label>{t("Parcours (Team IA)")}</label>
                <select
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    const tm = teams.find((x) => x.id === e.target.value);
                    if (tm?.lead_agent_handle_id) setAgentHandleId(tm.lead_agent_handle_id);
                  }}
                >
                  {teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name} · {tm.member_count} agent{tm.member_count === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
                {selectedTeam && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    {selectedTeam.lead_agent_handle_id ? (
                      <>
                        ✅ <strong>{agents.find((a) => a.id === selectedTeam.lead_agent_handle_id)?.display_name ?? t("Le 1er agent")}</strong> {t("répond")}{" "}
                        {t("à l'appel, puis transfère automatiquement selon")}{" "}
                        <a href={`/teams/${selectedTeam.id}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent-2)" }}>
                          {t("le parcours défini")}
                        </a>.
                      </>
                    ) : (
                      <span style={{ color: "#ffb060" }}>
                        ⚠️ {t("Cette team n'a pas d'agent « 1er appel ». Ouvrez")}{" "}
                        <a href={`/teams/${selectedTeam.id}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent-2)" }}>{t("le parcours")}</a>{" "}
                        {t("pour en définir un.")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Script — optional refinement, clearly secondary. */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <label>{t("Script de conversation (optionnel)")}</label>
          <select value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
            <option value="">{t("— Aucun (l'agent suit son prompt) —")}</option>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.mission ? ` — ${s.mission}` : ""}
              </option>
            ))}
          </select>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {scriptId ? (
              <>{scripts.find((s) => s.id === scriptId)?.description ?? t("Ce script guide la conversation pour cette campagne.")}</>
            ) : (
              <>{t("Laisse vide pour utiliser le comportement par défaut de l'agent. Un script ajoute un objectif précis pour CETTE campagne.")}</>
            )}
          </div>
        </div>
      </section>

      {/* 3. Numéro émetteur */}
      <section className="card">
        <h3>{t("3. Numéro affiché")}</h3>
        <div className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          {t("Le numéro qui s'affiche sur le téléphone de la personne appelée.")}
        </div>
        <div className="wizard-row-2">
          <div>
            <label>{t("Numéro Twilio")}</label>
            <select
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            >
              <option value="">{t("— Aucun —")}</option>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.e164} {n.label ? `(${n.label})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{t("Ou caller-id (E.164)")}</label>
            <input
              value={callerIdOverride}
              onChange={(e) => setCallerIdOverride(e.target.value)}
              placeholder="+33123456789"
            />
          </div>
        </div>
        {selectedNumber && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {t("Sera utilisé comme")} <span className="kbd">From</span> {t("sur les appels Twilio.")}
          </div>
        )}
      </section>
      </>)}

      {/* ─── STEP 2: Qui appeler ? ────────────────────────────────────── */}
      {currentStep === 2 && (<>
      {/* 4. Cibles */}
      <section className="card">
        <h3>{t("4. Qui appeler ?")}</h3>
        <div className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          {t("La liste de contacts à appeler et la façon de les appeler (une fois, ou en continu avec relances).")}
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {dataTables.length > 0 && (
            <div style={{ background: "var(--bg-2)", padding: 12, borderRadius: 8, display: "grid", gap: 10 }}>
              <div>
                <label>{t("Table de contacts (recommandé)")}</label>
                <select value={dataTableId} onChange={(e) => onPickDataTable(e.target.value)}>
                  <option value="">{t("— Pas de table (utiliser CSV ci-dessous) —")}</option>
                  {dataTables.map((tbl) => (
                    <option key={tbl.id} value={tbl.id}>
                      {tbl.label} ({tbl.physical_table}) · {tbl.row_count} contact{tbl.row_count === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {dataTableId
                    ? `Les variables ({{nom}}, {{bmi}}…) viennent des colonnes de cette table, et l'agent y réécrit ses résultats.`
                    : `Choisis la table à appeler. Gère tes tables dans CRM / Contacts.`}
                </div>
              </div>

              {selectedDataTable && (
                <div>
                  <label>{t("Type de campagne")}</label>
                  <div className="wizard-row-2">
                    <label
                      style={{
                        display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                        padding: 12, borderRadius: 8,
                        border: `1px solid ${dynamicMode ? "var(--accent)" : "var(--border)"}`,
                        background: dynamicMode ? "var(--accent-soft)" : "var(--bg-2)",
                      }}
                    >
                      <input type="radio" name="campaign_type" checked={dynamicMode}
                        onChange={() => setDynamicMode(true)} style={{ width: "auto", marginTop: 2 }} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{t("Campagne continue 🔁")}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          {t("Re-sélectionne les contacts à chaque créneau selon vos règles :")}{" "}
                          {t("statuts ciblés, relances J+X, plafond d'appels/jour. (logique J1/J3/J5)")}
                        </div>
                      </div>
                    </label>
                    <label
                      style={{
                        display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                        padding: 12, borderRadius: 8,
                        border: `1px solid ${!dynamicMode ? "var(--accent)" : "var(--border)"}`,
                        background: !dynamicMode ? "var(--accent-soft)" : "var(--bg-2)",
                      }}
                    >
                      <input type="radio" name="campaign_type" checked={!dynamicMode}
                        onChange={() => setDynamicMode(false)} style={{ width: "auto", marginTop: 2 }} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{t("Appel unique 📞")}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          {t("Appelle une seule fois chaque contact de la table, sans relances automatiques.")}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {selectedDataTable && dynamicMode && engineConfig && (
                isHumanCampaign ? (
                  // Human desk campaign: a friendly target picker (qualification
                  // and/or assignment) instead of the full engine form — the
                  // operator just chooses which leads this agent calls.
                  <HumanLeadSelection
                    facetQual={facetQual}
                    facetAgent={facetAgent}
                    loaded={facetsLoaded}
                    selectedQuals={humanQuals}
                    selectedAssigned={humanAssigned}
                    onToggleQual={toggleHumanQual}
                    onToggleAssigned={toggleHumanAssigned}
                  />
                ) : (
                  <DynamicEngineConfig
                    columns={selectedDataTable.columns}
                    phoneColumn={selectedDataTable.phone_column}
                    value={engineConfig}
                    onChange={setEngineConfig}
                    // Créneaux are configured once in step 3 (single source of
                    // truth — no more dual UI between engine + planning). Same
                    // for the multi-day relances (J1/J3/J5) — those are timing
                    // logic and belong with step 3 "Quand", not "Qui appeler".
                    hideSlots
                    section="no-cadence"
                  />
                )
              )}
            </div>
          )}

          {selectedDataTable ? (
            // A data table is the source of truth — the CSV/contact picker would
            // only confuse (and isn't used for table-backed campaigns).
            <div className="muted" style={{ fontSize: 13, padding: 12, background: "var(--bg-2)", borderRadius: 8, lineHeight: 1.5 }}>
              📋 {t("Cible : table")} <strong>{selectedDataTable.label}</strong> ({selectedDataTable.row_count} contact{selectedDataTable.row_count === 1 ? "" : "s"}).
              {dynamicMode
                ? t(" Le moteur sélectionne les contacts à appeler à chaque créneau selon tes règles ci-dessus (statuts, relances). Pas besoin de coller une liste.")
                : t(" Tous les contacts de la table seront appelés une fois.")}
            </div>
          ) : (
            <>
              <div>
                <label>{t("Coller un CSV (e164,nom)")}</label>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={"+33612345678,Jean Dupont\n+33687654321,Marie Martin"}
                  style={{ minHeight: 120, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
                />
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {csvTargets.length} {t("cible")}{csvTargets.length === 1 ? "" : t("s")} {t("valide")}{csvTargets.length === 1 ? "" : t("s")} {t("détectée")}{csvTargets.length === 1 ? "" : t("s")}.
                </div>
              </div>
              <div>
                <label>{t("… ou importer depuis les contacts existants")}</label>
                <input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder={t("Filtrer (nom ou numéro)…")}
                />
                <div
                  style={{
                    marginTop: 8,
                    maxHeight: 200,
                    overflowY: "auto",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 8,
                    background: "var(--bg-2)",
                  }}
                >
                  {filteredContacts.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12 }}>{t("Aucun contact")}</div>
                  ) : (
                    filteredContacts.map((c) => (
                      <label
                        key={c.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 0",
                          cursor: "pointer",
                          margin: 0,
                          color: "var(--text)",
                        }}
                      >
                        <input
                          type="checkbox"
                          style={{ width: "auto" }}
                          checked={pickedContactIds.has(c.id)}
                          onChange={() => togglePicked(c.id)}
                        />
                        <span>
                          {c.display_name ?? c.e164}{" "}
                          <span className="muted" style={{ fontSize: 12 }}>{c.e164}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {pickedContactIds.size} {t("contact")}{pickedContactIds.size === 1 ? "" : t("s")} {t("sélectionné")}{pickedContactIds.size === 1 ? "" : t("s")}.
                </div>
              </div>
              {!selectedDataTable && !contactListId && (
                <div className="muted" style={{ fontSize: 13 }}>
                  <strong>{t("Total cibles (déduplication par e164) :")}</strong> {targets.length}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* 5. Message avant l'appel (SMS et/ou WhatsApp) */}
      <section className="card">
        <h3>{t("5. Message avant l'appel")}{" "}
          <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(optionnel)</span>
        </h3>
        <div className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          {t("Coche")} <strong>SMS</strong> {t("et/ou")} <strong>WhatsApp</strong> {t("pour prévenir le patient")}{" "}
          <strong>{t("avant chaque appel")}</strong> {t("(il reconnaît le numéro et décroche plus facilement).")}{" "}
          {t("Le")} <em>{t("moment")}</em> {t("de l'envoi (combien de minutes avant) se règle à l'étape « Quand ? ».")}
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {/* SMS */}
          <div style={{ border: `1px solid ${precallSmsOn ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, padding: 12, background: precallSmsOn ? "var(--accent-soft)" : "var(--bg-2)" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", margin: 0, fontWeight: 600 }}>
              <input type="checkbox" checked={precallSmsOn} onChange={(e) => setPrecallSmsOn(e.target.checked)} style={{ width: "auto" }} />
              💬 SMS
            </label>
            {precallSmsOn && (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <div>
                  <label>{t("Modèle SMS")}</label>
                  <ContentSidPicker channel="SMS" templates={templates} templatesLoaded={templatesLoaded} value={precallSmsSid} onChange={setPrecallSmsSid} />
                </div>
                <div>
                  <label>{t("Numéro d'envoi SMS")}</label>
                  <input value={precallSmsFrom} onChange={(e) => setPrecallSmsFrom(e.target.value)} placeholder={t("défaut : numéro de la campagne")} />
                </div>
                {!precallSmsSid.trim() && <div style={{ fontSize: 12, color: "#b45309" }}>{t("⚠️ Renseigne le Content SID, sinon le SMS ne partira pas.")}</div>}
              </div>
            )}
          </div>
          {/* WhatsApp */}
          <div style={{ border: `1px solid ${precallWaOn ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, padding: 12, background: precallWaOn ? "var(--accent-soft)" : "var(--bg-2)" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", margin: 0, fontWeight: 600 }}>
              <input type="checkbox" checked={precallWaOn} onChange={(e) => setPrecallWaOn(e.target.checked)} style={{ width: "auto" }} />
              🟢 WhatsApp
            </label>
            {precallWaOn && (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <div>
                  <label>{t("Modèle WhatsApp")}</label>
                  <ContentSidPicker channel="WhatsApp" templates={templates} templatesLoaded={templatesLoaded} value={precallWaSid} onChange={setPrecallWaSid} />
                </div>
                <div>
                  <label>{t("Numéro d'envoi WhatsApp")}</label>
                  <input value={precallWaFrom} onChange={(e) => setPrecallWaFrom(e.target.value)} placeholder={t("numéro WhatsApp Business Twilio")} />
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t("Doit être un numéro activé WhatsApp Business chez Twilio.")}</div>
                </div>
                {!precallWaSid.trim() && <div style={{ fontSize: 12, color: "#b45309" }}>{t("⚠️ Renseigne le Content SID, sinon le WhatsApp ne partira pas.")}</div>}
              </div>
            )}
          </div>
        </div>
      </section>
      </>)}

      {/* ─── STEP 3: Quand ? ──────────────────────────────────────────── */}
      {currentStep === 3 && (<>
      {/* Pre-call message timing — only shown when SMS/WhatsApp was enabled in
          step 2, so the "Quand ?" step asks for the moment of sending. */}
      {precallOn && (
        <section className="card" style={{ borderLeft: "4px solid var(--accent)", marginBottom: 8 }}>
          <h3>{t("💬 Message avant l'appel — quand l'envoyer ?")}</h3>
          <div className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 8 }}>
            {t("Tu as activé")} {precallSmsOn && precallWaOn ? "SMS + WhatsApp" : precallSmsOn ? t("le SMS") : t("le WhatsApp")}.
            {" "}{t("À combien de minutes")} <strong>{t("avant chaque appel")}</strong> {t("faut-il l'envoyer ?")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="number" min={1} max={15} value={precallLeadMin}
              onChange={(e) => setPrecallLeadMin(Number(e.target.value))} style={{ width: 100 }} />
            <span>{t("minute(s) avant l'appel")}</span>
          </div>
        </section>
      )}
      {/* Always-visible mode banner so the operator knows exactly what their
          créneau settings will produce. Without this the wizard silently
          picked static or dynamic based on whether a data table was selected
          in step 2, and the operator had no way to know which model applied
          to their "Plages horaires" input. */}
      <section className="card" style={{
        background: dynamicMode && dataTableId ? "var(--accent-soft)" : "var(--bg-2)",
        borderLeft: `4px solid ${dynamicMode && dataTableId ? "var(--accent)" : "var(--muted)"}`,
        marginBottom: 8,
      }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
          {dynamicMode && dataTableId
            ? t("🔁 Mode : campagne continue (tirée d'une table de contacts)")
            : t("📞 Mode : campagne one-shot (liste fixe)")}
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {dynamicMode && dataTableId ? (
            <>
              {t("À chaque")} <strong>{t("début")}</strong> {t("de plage horaire configurée")}{" "}
              {t("ci-dessous, le moteur lance une wave d'appels en piochant dans")}{" "}
              {t("la table")} {selectedDataTable ? <strong>{selectedDataTable.label}</strong> : t("sélectionnée")} {t("selon")}{" "}
              {t("les règles (statuts ciblés, cadence J1/J3/J5). Exemple : plage")}{" "}
              {t("10:00-12:00 = une wave qui démarre à 10:00.")}
              <br />
              {t("Les leads en statut")} <strong>RAPPEL</strong> {t("sont rappelés à la")}{" "}
              {t("prochaine plage qui suit leur")} <code>rappel_rdv</code>.
            </>
          ) : (
            <>
              {t("Les appels de ta liste de contacts seront passés")} <strong>{t("en continu pendant")}</strong> {t("les")}{" "}
              {t("plages horaires ci-dessous. Aucun appel en dehors de ces")}{" "}
              {t("fenêtres. Une seule passe sur la liste — pas de re-tirage")}{" "}
              {t("automatique.")}
            </>
          )}
        </div>
      </section>

      {/* 5a. Chat-first scheduling — the operator describes their cadence and
          the assistant fills the planning + creates the draft on "go". */}
      {!manualSchedule && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>{t("5. Quand ? — discute avec l'assistant")}</h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {t("Explique ton rythme d'appels en langage naturel. L'assistant remplit la")}{" "}
                {t("planification (récap ci-dessous) et crée la campagne en brouillon quand tu dis « go ».")}
              </div>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => setManualSchedule(true)}
              style={{ whiteSpace: "nowrap", padding: "6px 12px" }}
            >
              {t("✏️ Régler à la main")}
            </button>
          </div>
          <ScheduleChatPanel
            context={scheduleChatContext}
            onProposal={applyChatProposal}
            onFinalize={finalizeFromChat}
          />
        </section>
      )}

      {/* 5b. Manual planning form — fallback for fine-tuning by hand. */}
      {manualSchedule && (
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{t("5. Créneaux & cadence")}</h3>
          <button
            type="button"
            className="ghost"
            onClick={() => setManualSchedule(false)}
            style={{ padding: "6px 12px", whiteSpace: "nowrap" }}
          >
            {t("💬 Revenir au chat")}
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          {t("Jours, plage horaire et cadence d'appel — une seule source de vérité.")}
        </div>
        {/* Cadence inputs moved BELOW the toggle button (further down in this
            section) so when the user clicks 'Réglages avancés' the panel
            expands right where they're looking, not far above the créneaux
            block they were scrolling through. */}

        {/* Single créneaux editor — always visible. In dynamic mode the
            values below are also synced into engineConfig.slots at submit
            time so the continuous engine fires inside this window. */}
        <>
            <div style={{ marginTop: 12 }}>
              <label>{t("Jours autorisés")}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DAYS.map((d) => {
                  const active = days.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      className={active ? "" : "ghost"}
                      onClick={() => toggleDay(d.id)}
                      style={{ padding: "6px 12px" }}
                    >
                      {t(d.label)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label>{t("Fuseau horaire")}</label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONE_GROUPS.map((group) => (
                  <optgroup key={group.group} label={group.group}>
                    {group.items.map((tz) => (
                      <option key={tz.id} value={tz.id}>{tz.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
        <div style={{ marginTop: 12 }}>
          <label>{t("Plages horaires")}</label>
          <div style={{ display: "grid", gap: 8 }}>
            {hourRanges.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="time"
                  value={r.start}
                  onChange={(e) => updateRange(i, { start: e.target.value })}
                  style={{ width: "auto" }}
                />
                <span className="muted">→</span>
                <input
                  type="time"
                  value={r.end}
                  onChange={(e) => updateRange(i, { end: e.target.value })}
                  style={{ width: "auto" }}
                />
                <span className="muted" style={{ fontSize: 11 }}>
                  = {localToUtc(r.start, timezone)}–{localToUtc(r.end, timezone)} UTC
                </span>
                {hourRanges.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRange(i)}
                    title={t("Supprimer cette plage")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4, fontSize: 16 }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="ghost"
              onClick={addRange}
              style={{ padding: "6px 12px", alignSelf: "flex-start" }}
            >
              {t("+ Ajouter une plage")}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            {t("ℹ️ Tu peux définir plusieurs plages par jour (ex. 10:00–13:00 puis 14:00–18:00).")}{" "}
            {t("Les heures sont saisies en heure locale du fuseau choisi ci-dessus, converties")}{" "}
            {t("en UTC pour le serveur d'appels.")}
          </div>
          {/* Concrete "what will happen" preview based on the operator's
              actual ranges and mode. Read this before judging the wizard:
              the operator was previously left guessing whether a range
              meant "wave at start" or "continuous in window". */}
          {hourRanges.length > 0 && hourRanges.some((r) => r.start && r.end) && (
            <div style={{
              marginTop: 10, padding: 10, background: "var(--bg-2)",
              borderRadius: 6, fontSize: 12, lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {t("📅 Ce que cette config va produire :")}
              </div>
              {dynamicMode && dataTableId ? (
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {hourRanges.filter((r) => r.start && r.end).map((r, i) => (
                    <li key={i}>
                      {t("Une wave d'appels qui démarre à")} <strong>{r.start}</strong> ({TZ_LABEL_BY_ID[timezone] ?? timezone}),
                      {" "}{t("et s'arrête au plus tard à")} <strong>{r.end}</strong>.
                    </li>
                  ))}
                  <li className="muted" style={{ marginTop: 4 }}>
                    {t("Soit")} <strong>{hourRanges.filter((r) => r.start && r.end).length}{" "}
                    wave{hourRanges.filter((r) => r.start && r.end).length > 1 ? "s" : ""}/jour</strong> ·{" "}
                    {t("jours actifs :")} {days.map((d) => { const found = DAYS.find((x) => x.id === d); return found ? t(found.label) : undefined; }).filter(Boolean).join(", ") || t("aucun")}
                  </li>
                </ul>
              ) : (
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {hourRanges.filter((r) => r.start && r.end).map((r, i) => (
                    <li key={i}>
                      {t("Appels passés en continu entre")} <strong>{r.start}</strong> {t("et")} <strong>{r.end}</strong> ({TZ_LABEL_BY_ID[timezone] ?? timezone}).
                    </li>
                  ))}
                  <li className="muted" style={{ marginTop: 4 }}>
                    {t("Jours actifs :")} {days.map((d) => { const found = DAYS.find((x) => x.id === d); return found ? t(found.label) : undefined; }).filter(Boolean).join(", ") || t("aucun")} ·{" "}
                    {t("Aucun appel en dehors de ces fenêtres.")}
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>
          </>

        {/* Multi-day retries (J1/J3/J5) — moved from step 2 because it's
            timing logic, not "who to call" logic. Only shown when a data
            table is in play and the dynamic engine is active. */}
        {selectedDataTable && dynamicMode && engineConfig && (
          <div style={{ marginTop: 14 }}>
            <DynamicEngineConfig
              columns={selectedDataTable.columns}
              phoneColumn={selectedDataTable.phone_column}
              value={engineConfig}
              onChange={setEngineConfig}
              section="cadence-only"
              hideSlots
            />
          </div>
        )}

        {/* Réglages avancés — collapsed by default; the template provides
            sensible defaults so most users never need to open this. */}
        <button
          type="button"
          className="ghost"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{ marginTop: 14, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "space-between" }}
        >
          <span>
            {showAdvanced ? t("▾ Réglages avancés") : t("▸ Réglages avancés")}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            {maxConcurrency} {t("simultanés")} · {maxAttempts} {maxAttempts > 1 ? t("tentatives") : t("tentative")} · retry {retryDelayMin} min
          </span>
        </button>

        {showAdvanced && (
          <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-2)" }}>
            <div className="wizard-row-3">
              <div>
                <label>{t("Appels simultanés (max)")}</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxConcurrency}
                  onChange={(e) => setMaxConcurrency(Number(e.target.value) || 1)}
                />
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {t("Nb d'appels passés en même temps. Plus élevé = plus rapide, mais plus d'agents occupés.")}
                </div>
                {maxConcurrency > PLAN_CONCURRENCY_LIMIT && (
                  <div
                    style={{
                      fontSize: 11, marginTop: 6, padding: "6px 8px", borderRadius: 6,
                      background: "color-mix(in srgb, var(--warn) 12%, var(--bg-2))",
                      color: "var(--warn)", border: "1px solid var(--warn)",
                    }}
                  >
                    {t("⚠️ Ton plan actuel limite la transcription temps réel à")}{" "}
                    <strong> {PLAN_CONCURRENCY_LIMIT} {t("appels simultanés")}</strong> (AssemblyAI).{" "}
                    {t("Les appels au-delà attendront leur tour — passe sur un plan supérieur")}{" "}
                    {t("pour lever la limite.")}
                  </div>
                )}
              </div>
              <div>
                <label>{t("Tentatives max")}</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value) || 1)}
                />
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {t("Rappels si pas de réponse / occupé, avant d'abandonner un numéro.")}
                </div>
              </div>
              <div>
                <label>{t("Délai retry (min)")}</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={retryDelayMin}
                  onChange={(e) => setRetryDelayMin(Number(e.target.value) || 1)}
                />
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {t("Temps d'attente avant de re-tenter un numéro injoignable.")}
                </div>
              </div>
            </div>
            {/* AMD checkbox intentionally removed from the wizard — the
                voicemail detection stack now relies on the agent's STT regex
                + idle watchdog instead of Twilio AMD (which kept false-
                positiving real humans who didn't speak in the first 1-3s).
                The amd_enabled flag is preserved on the row so existing
                campaigns and edit-page experiments keep working. */}
          </div>
        )}
      </section>
      )}

      {/* Sentinel Wave 1: preflight panel above the recap. */}
      <PreflightPanel result={preflightResult} />

      {/* 6. Récap */}
      <section className="card">
        <h3>{t("6. Récapitulatif")}</h3>
        <div className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          {t("Vérifie avant de créer. La campagne est créée en brouillon — tu la démarres ensuite.")}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", lineHeight: 1.7 }}>
          <li>
            <strong style={{ color: "var(--text)" }}>{name || t("(sans nom)")}</strong>
            {description && ` — ${description}`}
          </li>
          <li>{t("Agent :")} {selectedAgent?.display_name ?? "—"}</li>
          <li>
            {t("Numéro :")} {selectedNumber?.e164 ?? callerIdOverride ?? "—"}
          </li>
          <li>
            {selectedDataTable
              ? `${t("Source : table")} « ${selectedDataTable.label} » · ${selectedDataTable.row_count} contact${selectedDataTable.row_count === 1 ? "" : "s"} ${t("dans la table")}${dynamicMode ? t(" (tirage continu selon vos règles)") : ""}`
              : contactListId
                ? t("Source : liste de contacts sélectionnée")
                : `${targets.length} ${t("cible")}${targets.length === 1 ? "" : t("s")} ${t("(liste fixe)")}`}
          </li>
          <li>
            {t("Concurrence")} {maxConcurrency} · {t("Retries")} {maxAttempts} ({retryDelayMin}min)
          </li>
          {dynamicMode && engineConfig ? (
            <li>
              {t("Créneaux")} ({TZ_LABEL_BY_ID[timezone] ?? timezone}) : {days.map((d) => { const found = DAYS.find((x) => x.id === d); return found ? t(found.label) : undefined; }).filter(Boolean).join(", ") || "—"}
              {" · "}
              {hourRanges.map((r) => `${r.start}–${r.end}`).join(" + ") || "—"}
              {" · max "}
              {engineConfig.volume.max_new_per_day} {t("nouveaux/créneau")}
            </li>
          ) : (
            <li>
              {t("Fenêtre :")} {days.map((d) => { const found = DAYS.find((x) => x.id === d); return found ? t(found.label) : undefined; }).filter(Boolean).join(", ")} · {hourRanges.map((r) => `${r.start}–${r.end}`).join(" + ")} ({TZ_LABEL_BY_ID[timezone] ?? timezone}) <span className="muted">→ {hourRanges.map((r) => `${localToUtc(r.start, timezone)}–${localToUtc(r.end, timezone)}`).join(" + ")} UTC</span>
            </li>
          )}
        </ul>
        {error && (
          <div style={{ color: "var(--bad)", marginTop: 12, fontSize: 14 }}>{error}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={submit}
            disabled={submitting || !preflightClear}
            title={!preflightClear ? t("Corrige les blocages ci-dessus pour pouvoir lancer.") : undefined}
          >
            {submitting ? t("Création…") : t("Créer en brouillon")}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => router.push("/campaigns")}
            disabled={submitting}
          >
            {t("Annuler")}
          </button>
        </div>
      </section>
      </>)}

      {/* ─── Step navigation footer ───────────────────────────────────── */}
      <div className="card wizard-nav" style={{ display: "flex", gap: 10, padding: 12, alignItems: "center", justifyContent: "space-between" }}>
        <button
          type="button"
          className="ghost"
          onClick={() => setCurrentStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
          disabled={currentStep === 1}
        >
          {t("← Précédent")}
        </button>
        <div className="muted wizard-nav-label" style={{ fontSize: 12 }}>
          {t("Étape")} {currentStep} / 3 — {(() => { const s = STEPS.find((s) => s.n === currentStep); return s ? t(s.label) : ""; })()}
        </div>
        {currentStep < 3 ? (
          <button
            type="button"
            onClick={() => setCurrentStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))}
            disabled={(currentStep === 1 && !step1Valid) || (currentStep === 2 && !step2Valid)}
            title={
              currentStep === 1 && !step1Valid
                ? t("Renseigne le nom, l'agent et le numéro pour continuer.")
                : currentStep === 2 && !step2Valid
                  ? t("Choisis une source de contacts pour continuer.")
                  : ""
            }
          >
            {t("Suivant →")}
          </button>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>{t("↓ Vérifie le récap puis crée")}</div>
        )}
      </div>
    </div>
  );
}
